import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiService } from './ai.service';
import { Chunk } from '../entities/chunk.entity';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { ElasticsearchService, SearchChunk } from '../infrastructure/elasticsearch/elasticsearch.service';
import { LoggerService, LogServiceCall } from '../common/logger';

export interface RetrievedChunk extends SearchChunk {
  vectorScore?: number;
  keywordScore?: number;
  rerankScore?: number;
}

export interface VectorSearchHit {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new LoggerService(RetrievalService.name);

  constructor(
    @InjectRepository(Chunk) private readonly chunkRepository: Repository<Chunk>,
    private readonly aiService: AiService,
    private readonly neo4jService: Neo4jService,
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {}

  @LogServiceCall()
  async retrieve(query: string, documentIds?: string[]): Promise<RetrievedChunk[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const embedding = await this.embedQuery(normalizedQuery);
    const [vectorResult, keywordResult] = await Promise.allSettled([
      this.searchVector(embedding, documentIds),
      this.searchKeyword(normalizedQuery, documentIds),
    ]);
    if (vectorResult.status === 'rejected' && keywordResult.status === 'rejected') {
      throw new Error('向量检索与关键词检索均不可用');
    }
    const fused = this.fuse(
      vectorResult.status === 'fulfilled' ? vectorResult.value : [],
      keywordResult.status === 'fulfilled' ? keywordResult.value : [],
    );
    const reranked = await this.rerank(normalizedQuery, fused.slice(0, 30));
    return this.selectAndExpand(reranked);
  }

  @LogServiceCall()
  normalizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }

  @LogServiceCall()
  embedQuery(query: string): Promise<number[]> {
    return this.aiService.generateEmbedding(query);
  }

  @LogServiceCall()
  searchVector(embedding: number[], documentIds?: string[]): Promise<VectorSearchHit[]> {
    return this.neo4jService.search(embedding, 30, documentIds);
  }

  @LogServiceCall()
  searchKeyword(query: string, documentIds?: string[]): Promise<SearchChunk[]> {
    return this.elasticsearchService.search(query, 30, documentIds);
  }

  @LogServiceCall()
  async selectAndExpand(reranked: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    const threshold = Number(this.configService.get<string>('RAG_MIN_SCORE', '0.15'));
    const selected = reranked.filter((item) => item.score >= threshold).slice(0, 8);
    return this.expandNeighbors(selected, Number(this.configService.get<string>('RAG_CONTEXT_TOKEN_BUDGET', '6000')));
  }

  @LogServiceCall()
  fuse(
    vectorHits: VectorSearchHit[],
    keywordHits: SearchChunk[],
  ): RetrievedChunk[] {
    const results = new Map<string, RetrievedChunk>();
    const k = 60;
    vectorHits.forEach((hit, rank) => {
      const chunkId = typeof hit.metadata.chunkId === 'string' ? hit.metadata.chunkId : '';
      if (!chunkId) return;
      results.set(chunkId, {
        chunkId,
        documentId: typeof hit.metadata.documentId === 'string' ? hit.metadata.documentId : '',
        documentName: typeof hit.metadata.documentName === 'string' ? hit.metadata.documentName : '',
        content: hit.content,
        chunkIndex: Number(hit.metadata.chunkIndex ?? 0),
        metadata: hit.metadata,
        vectorScore: hit.score,
        score: 1 / (k + rank + 1),
      });
    });
    keywordHits.forEach((hit, rank) => {
      const existing = results.get(hit.chunkId);
      const rrf = 1 / (k + rank + 1);
      results.set(hit.chunkId, {
        ...(existing ?? hit),
        keywordScore: hit.score,
        score: (existing?.score ?? 0) + rrf,
      });
    });
    const maxScore = Math.max(...[...results.values()].map((item) => item.score), Number.EPSILON);
    return [...results.values()]
      .map((item) => ({ ...item, score: item.score / maxScore }))
      .sort((a, b) => b.score - a.score);
  }

  @LogServiceCall()
  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];
    const apiKey = this.configService.get<string>('QWEN_API_KEY');
    const endpoint = this.configService.get<string>(
      'QWEN_RERANK_URL',
      'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
    );
    if (!apiKey) return chunks;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.configService.get<string>('QWEN_RERANK_MODEL', 'gte-rerank-v2'),
          input: { query, documents: chunks.map((item) => item.content) },
          parameters: { return_documents: false, top_n: chunks.length },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as {
        output?: { results?: Array<{ index: number; relevance_score: number }> };
      };
      const scored = payload.output?.results ?? [];
      if (!scored.length) throw new Error('重排服务返回空结果');
      return scored.map((result) => ({
        ...chunks[result.index],
        score: result.relevance_score,
        rerankScore: result.relevance_score,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`云端重排失败，降级为RRF排序 - 错误: ${message}`);
      return chunks;
    }
  }

  private async expandNeighbors(selected: RetrievedChunk[], tokenBudget: number): Promise<RetrievedChunk[]> {
    if (selected.length === 0) return [];
    const documentIds = [...new Set(selected.map((item) => item.documentId))];
    const neighbors = await this.chunkRepository.find({
      where: { documentId: In(documentIds) },
      order: { chunkIndex: 'ASC' },
    });
    const selectedKeys = new Set(selected.map((item) => item.chunkId));
    const output = [...selected];
    let tokens = selected.reduce((sum, item) => sum + this.estimateTokens(item.content), 0);
    for (const hit of selected) {
      for (const neighbor of neighbors.filter(
        (item) => item.documentId === hit.documentId && Math.abs(item.chunkIndex - hit.chunkIndex) === 1,
      )) {
        if (selectedKeys.has(neighbor.id) || tokens + neighbor.tokenCount > tokenBudget) continue;
        selectedKeys.add(neighbor.id);
        tokens += neighbor.tokenCount;
        output.push({
          chunkId: neighbor.id,
          documentId: neighbor.documentId,
          documentName:
            typeof neighbor.metadata?.documentName === 'string' ? neighbor.metadata.documentName : hit.documentName,
          content: neighbor.content,
          chunkIndex: neighbor.chunkIndex,
          score: hit.score,
          metadata: {
            ...(neighbor.metadata || {}),
            pageNumber: neighbor.pageNumber,
            sheetName: neighbor.sheetName,
            rowRange: neighbor.rowRange,
            slideNumber: neighbor.slideNumber,
            headingPath: neighbor.headingPath,
            startMs: neighbor.startMs,
            endMs: neighbor.endMs,
          },
        });
      }
    }
    return output.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.chunkIndex - b.chunkIndex);
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 2);
  }
}
