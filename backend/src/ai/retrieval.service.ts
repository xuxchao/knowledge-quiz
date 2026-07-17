import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiService } from './ai.service';
import { Chunk } from '../entities/chunk.entity';
import { PostgresVectorService } from '../infrastructure/postgres-vector/postgres-vector.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import type { GraphEvidence, NovelQueryPlan } from '../infrastructure/neo4j/novel-graph.types';
import { ElasticsearchService, SearchChunk } from '../infrastructure/elasticsearch/elasticsearch.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import type { ChatTraceContext } from '../infrastructure/langfuse/langfuse.service';

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
    private readonly postgresVectorService: PostgresVectorService,
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
  async analyzeNovelQuery(query: string, context?: ChatTraceContext): Promise<NovelQueryPlan> {
    try {
      const raw = await this.aiService.generateStructuredJson<Partial<NovelQueryPlan>>(
        '判断小说问题需要文本检索、图谱检索还是混合检索。人物关系、章节顺序、首次出现、组织成员、事件参与或因果问题使用graph或hybrid；情节细节使用text。输出字段mode、entities、relationshipKinds、chapterOrdinal、novelTitle。',
        query,
        'rag.novel-query-plan',
        undefined,
        context,
      );
      const mode = ['text', 'graph', 'hybrid'].includes(String(raw.mode)) ? raw.mode! : 'text';
      const chapterOrdinal = Number(raw.chapterOrdinal);
      return {
        mode,
        entities: this.stringArray(raw.entities).slice(0, 10),
        relationshipKinds: this.stringArray(raw.relationshipKinds)
          .map((value) => value.toUpperCase())
          .slice(0, 10),
        chapterOrdinal: Number.isInteger(chapterOrdinal) && chapterOrdinal > 0 ? chapterOrdinal : undefined,
        novelTitle: typeof raw.novelTitle === 'string' && raw.novelTitle.trim() ? raw.novelTitle.trim() : undefined,
      };
    } catch (error: unknown) {
      const structural =
        /关系|人物|角色|第.{0,8}章|章节|先后|首次|第一次|成员|属于|参与|导致|因果|敌人|盟友|师[徒父]|亲属/.test(query);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `小说检索路由分析失败，使用规则降级 - 错误: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { mode: structural ? 'hybrid' : 'text', entities: [], relationshipKinds: [] };
    }
  }

  @LogServiceCall()
  searchGraph(plan: NovelQueryPlan, documentIds?: string[]): Promise<GraphEvidence[]> {
    const topK = Number(this.configService.get<string>('NOVEL_GRAPH_RETRIEVAL_TOP_K', '20'));
    return this.neo4jService.searchGraph(plan, documentIds, topK);
  }

  @LogServiceCall()
  async attachGraphEvidence(chunks: RetrievedChunk[], evidence: GraphEvidence[]): Promise<RetrievedChunk[]> {
    const evidenceByChunk = new Map<string, GraphEvidence>();
    for (const item of evidence) {
      for (const chunkId of item.evidenceChunkIds) {
        const existing = evidenceByChunk.get(chunkId);
        if (!existing || existing.confidence < item.confidence) evidenceByChunk.set(chunkId, item);
      }
    }
    if (!evidenceByChunk.size) return chunks;
    const graphChunks = await this.chunkRepository.find({ where: { id: In([...evidenceByChunk.keys()]) } });
    const existingIds = new Set(chunks.map((chunk) => chunk.chunkId));
    const budget = Number(this.configService.get<string>('RAG_GRAPH_CONTEXT_TOKEN_BUDGET', '2000'));
    let tokens = 0;
    const additions: RetrievedChunk[] = [];
    for (const chunk of graphChunks.sort((left, right) => left.chunkIndex - right.chunkIndex)) {
      if (existingIds.has(chunk.id) || tokens + chunk.tokenCount > budget) continue;
      const graphEvidence = evidenceByChunk.get(chunk.id);
      if (!graphEvidence) continue;
      tokens += chunk.tokenCount;
      additions.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: graphEvidence.documentName,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: graphEvidence.confidence,
        metadata: {
          ...(chunk.metadata ?? {}),
          documentId: chunk.documentId,
          documentName: graphEvidence.documentName,
          chunkIndex: chunk.chunkIndex,
          graphEvidence: true,
        },
      });
    }
    return [...chunks, ...additions];
  }

  @LogServiceCall()
  normalizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }

  @LogServiceCall()
  embedQuery(query: string, context?: ChatTraceContext): Promise<number[]> {
    return this.aiService.generateEmbedding(query, context);
  }

  @LogServiceCall()
  searchVector(embedding: number[], documentIds?: string[]): Promise<VectorSearchHit[]> {
    return this.postgresVectorService.search(embedding, 30, documentIds);
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
  fuse(vectorHits: VectorSearchHit[], keywordHits: SearchChunk[]): RetrievedChunk[] {
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
  async rerank(query: string, chunks: RetrievedChunk[], context?: ChatTraceContext): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];
    try {
      const scored = await this.aiService.rerank(
        query,
        chunks.map((item) => item.content),
        context,
      );
      if (!scored) return chunks;
      return scored.map((result) => ({
        ...chunks[result.index],
        score: result.score,
        rerankScore: result.score,
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `云端重排失败，降级为RRF排序 - 错误: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
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

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
  }
}
