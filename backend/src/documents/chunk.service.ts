import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chunk } from '../entities/chunk.entity';

@Injectable()
export class ChunkService {
  constructor(
    @InjectRepository(Chunk)
    private chunkRepository: Repository<Chunk>,
  ) {}

  async findById(id: string): Promise<Chunk | null> {
    return this.chunkRepository.findOne({
      where: { id },
      relations: { document: true },
    });
  }

  async findByDocument(documentId: string, skip: number = 0, limit: number = 10): Promise<[Chunk[], number]> {
    const query = this.chunkRepository.createQueryBuilder('chunk');
    query.where('chunk.documentId = :documentId', { documentId });
    query.orderBy('chunk.chunkIndex', 'ASC');
    query.skip(skip).take(limit);

    return query.getManyAndCount();
  }

  async update(id: string, data: Record<string, unknown>): Promise<Chunk | null> {
    await this.chunkRepository.update(id, data);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.chunkRepository.delete(id);
  }
}
