import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Chunk } from '../entities/chunk.entity';
import { Document } from '../entities/document.entity';
import { LoggerService, LogServiceCall } from '../common/logger';
import { AiService } from '../ai/ai.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';

@Injectable()
export class ChunkService {
  private readonly logger = new LoggerService(ChunkService.name);

  constructor(
    @InjectRepository(Chunk)
    private chunkRepository: Repository<Chunk>,
    private dataSource: DataSource,
    private aiService: AiService,
    private neo4jService: Neo4jService,
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
      embedding: string;
      chunkIndex: number;
      totalChunks: number;
    }>,
  ): Promise<Chunk[]> {
    await this.chunkRepository.delete({ documentId });

    if (!chunks || chunks.length === 0) {
      return [];
    }

    const chunkEntities = chunks.map((chunk) =>
      this.chunkRepository.create({
        documentId,
        content: chunk.content,
        contentSearch: chunk.content,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.content.length,
        metadata: chunk.metadata,
        embedding: chunk.embedding,
      }),
    );

    const saved = await this.chunkRepository.save(chunkEntities);
    await this.neo4jService.deleteByDocumentId(documentId);
    await this.neo4jService.addDocumentsBatch(
      saved.map((chunk) => ({
        content: chunk.content,
        metadata: { ...(chunk.metadata || {}), chunkId: chunk.id, documentId },
      })),
      saved.map((chunk) => JSON.parse(chunk.embedding || '[]') as number[]),
    );
    return saved;
  }

  @LogServiceCall()
  async updateContent(id: string, content: string): Promise<Chunk | null> {
    const [embedding] = await this.aiService.generateEmbeddings([content]);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Chunk);
      const chunk = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!chunk) return null;

      chunk.content = content;
      chunk.contentSearch = content;
      chunk.tokenCount = content.length;
      chunk.embedding = JSON.stringify(embedding);
      const saved = await repository.save(chunk);
      await this.neo4jService.addDocuments(
        [{ content, metadata: { ...(chunk.metadata || {}), chunkId: chunk.id, documentId: chunk.documentId } }],
        [embedding],
      );
      return saved;
    });
  }

  @LogServiceCall()
  async delete(id: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Chunk);
      const chunk = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!chunk) return false;

      await this.neo4jService.deleteByChunkId(id);
      await repository.delete(id);
      await manager
        .createQueryBuilder()
        .update(Document)
        .set({ chunkCount: () => 'GREATEST("chunkCount" - 1, 0)' })
        .where('id = :documentId', { documentId: chunk.documentId })
        .execute();
      return true;
    });
  }

  @LogServiceCall()
  async cleanupDocument(documentId: string): Promise<void> {
    await this.neo4jService.deleteByDocumentId(documentId);
    await this.chunkRepository.delete({ documentId });
    await this.dataSource.getRepository(Document).update(documentId, { chunkCount: 0 });
  }
}
