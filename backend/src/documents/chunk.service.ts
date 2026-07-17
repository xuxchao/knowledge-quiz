import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Chunk } from '../entities/chunk.entity';
import { Document, NovelGraphStatus } from '../entities/document.entity';
import { LoggerService, LogServiceCall } from '../common/logger';
import { AiService } from '../ai/ai.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { ElasticsearchService } from '../infrastructure/elasticsearch/elasticsearch.service';
import { NovelGraphExtractionService } from './novel-graph-extraction.service';

@Injectable()
export class ChunkService {
  private readonly logger = new LoggerService(ChunkService.name);

  constructor(
    @InjectRepository(Chunk)
    private chunkRepository: Repository<Chunk>,
    private dataSource: DataSource,
    private aiService: AiService,
    private neo4jService: Neo4jService,
    private elasticsearchService: ElasticsearchService,
    private novelGraphExtractionService: NovelGraphExtractionService,
  ) {}

  @LogServiceCall()
  async findById(id: string): Promise<Chunk | null> {
    return this.chunkRepository.findOne({
      where: { id },
      relations: { document: true },
    });
  }

  @LogServiceCall()
  async findByDocument(documentId: string, skip: number = 0, limit: number = 10): Promise<[Chunk[], number]> {
    const query = this.chunkRepository.createQueryBuilder('chunk');
    query.where('chunk.documentId = :documentId', { documentId });
    query.orderBy('chunk.chunkIndex', 'ASC');
    query.skip(skip).take(limit);

    return query.getManyAndCount();
  }

  @LogServiceCall()
  async createForDocument(
    documentId: string,
    chunks: Array<{
      content: string;
      metadata: Record<string, unknown>;
      embedding: number[];
      chunkIndex: number;
      totalChunks: number;
      tokenCount?: number;
      pageNumber?: number;
      sheetName?: string;
      rowRange?: string;
      slideNumber?: number;
      headingPath?: string[];
      startMs?: number;
      endMs?: number;
    }>,
  ): Promise<Chunk[]> {
    const saved = await this.stageForDocument(documentId, chunks, null);
    await this.indexElasticsearch(documentId);
    await this.markIndexed(documentId);
    return saved;
  }

  @LogServiceCall()
  async stageForDocument(
    documentId: string,
    chunks: Parameters<ChunkService['createForDocument']>[1],
    ingestionRunId: string | null,
  ): Promise<Chunk[]> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Chunk);
      if (!chunks?.length) {
        await repository.delete({ documentId });
        return [];
      }
      const existing = await repository.find({ where: { documentId } });
      const existingByIndex = new Map(existing.map((chunk) => [chunk.chunkIndex, chunk]));
      const chunkIndexes = chunks.map((chunk) => chunk.chunkIndex);
      await repository
        .createQueryBuilder()
        .delete()
        .where('"documentId" = :documentId', { documentId })
        .andWhere('"chunkIndex" NOT IN (:...chunkIndexes)', { chunkIndexes })
        .execute();
      const chunkEntities = chunks.map((chunk) =>
        repository.create({
          id: existingByIndex.get(chunk.chunkIndex)?.id,
          documentId,
          content: chunk.content,
          contentSearch: chunk.content,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount ?? chunk.content.length,
          metadata: chunk.metadata,
          embedding: chunk.embedding,
          pageNumber: chunk.pageNumber,
          sheetName: chunk.sheetName,
          rowRange: chunk.rowRange,
          slideNumber: chunk.slideNumber,
          headingPath: chunk.headingPath,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          indexStatus: 'pending',
          ingestionRunId,
        }),
      );
      return repository.save(chunkEntities);
    });
  }

  @LogServiceCall()
  async indexElasticsearch(documentId: string): Promise<void> {
    const saved = await this.chunkRepository.find({ where: { documentId }, order: { chunkIndex: 'ASC' } });
    await this.elasticsearchService.deleteByDocumentId(documentId);
    await this.elasticsearchService.indexChunks(
      saved.map((chunk) => ({
        chunkId: chunk.id,
        documentId,
        documentName: typeof chunk.metadata?.documentName === 'string' ? chunk.metadata.documentName : documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score: 0,
        metadata: {
          ...(chunk.metadata || {}),
          pageNumber: chunk.pageNumber,
          sheetName: chunk.sheetName,
          rowRange: chunk.rowRange,
          slideNumber: chunk.slideNumber,
          headingPath: chunk.headingPath,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
        },
      })),
    );
  }

  @LogServiceCall()
  async markIndexed(documentId: string): Promise<void> {
    await this.chunkRepository.update({ documentId }, { indexStatus: 'indexed' });
  }

  @LogServiceCall()
  async updateContent(id: string, content: string): Promise<Chunk | null> {
    const [embedding] = await this.aiService.generateEmbeddings([content]);

    const saved = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Chunk);
      const chunk = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!chunk) return null;

      chunk.content = content;
      chunk.contentSearch = content;
      chunk.tokenCount = content.length;
      chunk.embedding = embedding;
      const saved = await repository.save(chunk);
      await this.elasticsearchService.indexChunks([
        {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName:
            typeof chunk.metadata?.documentName === 'string' ? chunk.metadata.documentName : chunk.documentId,
          content,
          chunkIndex: chunk.chunkIndex,
          score: 0,
          metadata: chunk.metadata || {},
        },
      ]);
      await manager.getRepository(Document).update(chunk.documentId, {
        graphStatus: NovelGraphStatus.STALE,
        graphError: '切片内容已修改，需要重建小说图谱',
      });
      return saved;
    });
    if (saved) this.triggerGraphRebuild(saved.documentId);
    return saved;
  }

  @LogServiceCall()
  async delete(id: string): Promise<boolean> {
    let documentId: string | undefined;
    const deleted = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Chunk);
      const chunk = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!chunk) return false;
      documentId = chunk.documentId;

      await this.elasticsearchService.deleteByChunkId(id);
      await repository.delete(id);
      await manager
        .createQueryBuilder()
        .update(Document)
        .set({ chunkCount: () => 'GREATEST("chunkCount" - 1, 0)' })
        .where('id = :documentId', { documentId: chunk.documentId })
        .execute();
      await manager.getRepository(Document).update(chunk.documentId, {
        graphStatus: NovelGraphStatus.STALE,
        graphError: '切片已删除，需要重建小说图谱',
      });
      return true;
    });
    if (deleted && documentId) this.triggerGraphRebuild(documentId);
    return deleted;
  }

  @LogServiceCall()
  async cleanupDocument(documentId: string): Promise<void> {
    const cleanupResults = await Promise.allSettled([
      this.neo4jService.deleteByDocumentId(documentId),
      this.elasticsearchService.deleteByDocumentId(documentId),
    ]);
    await this.chunkRepository.delete({ documentId });
    await this.dataSource.getRepository(Document).update(documentId, { chunkCount: 0 });
    const failures = cleanupResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) {
      throw new Error(`外部索引清理失败: ${failures.map((result) => String(result.reason)).join('; ')}`);
    }
  }

  private triggerGraphRebuild(documentId: string): void {
    void this.novelGraphExtractionService.extractAndStore(documentId).catch(async (error: unknown) => {
      await this.novelGraphExtractionService.markFailed(documentId, error);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `切片变更后的小说图谱重建失败 - 文档ID: ${documentId}，错误: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }
}
