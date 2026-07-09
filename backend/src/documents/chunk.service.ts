import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chunk } from '../entities/chunk.entity';
import { LoggerService, LogServiceCall } from '../common/logger';

@Injectable()
export class ChunkService {
  private readonly logger = new LoggerService(ChunkService.name);

  constructor(
    @InjectRepository(Chunk)
    private chunkRepository: Repository<Chunk>,
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

    return this.chunkRepository.save(chunkEntities);
  }

  @LogServiceCall()
  async update(id: string, data: Record<string, unknown>): Promise<Chunk | null> {
    await this.chunkRepository.update(id, data);
    return this.findById(id);
  }

  @LogServiceCall()
  async delete(id: string): Promise<void> {
    await this.chunkRepository.delete(id);
  }
}
