import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from '../entities/document.entity';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { ElasticsearchService } from '../infrastructure/elasticsearch/elasticsearch.service';

@Injectable()
export class DocumentService {
  private readonly logger = new LoggerService(DocumentService.name);

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private neo4jService: Neo4jService,
    private rustfsService: RustfsService,
    private redisService: RedisService,
    private elasticsearchService: ElasticsearchService,
  ) {}

  @LogServiceCall()
  async create(data: Partial<Document>): Promise<Document> {
    const document = this.documentRepository.create(data);
    return this.documentRepository.save(document);
  }

  @LogServiceCall()
  async findById(id: string, loadChunks: boolean = false): Promise<Document | null> {
    return this.documentRepository.findOne({
      where: { id },
      relations: loadChunks ? { chunks: true } : {},
    });
  }

  @LogServiceCall()
  async findByIdWithChunks(id: string): Promise<Document | null> {
    return this.findById(id, true);
  }

  @LogServiceCall()
  async findAll(name?: string, skip: number = 0, limit: number = 10): Promise<[Document[], number]> {
    const query = this.documentRepository.createQueryBuilder('document');

    if (name) {
      query.where('document.name LIKE :name', { name: `%${name}%` });
    }

    query.orderBy('document.createdAt', 'DESC');
    query.skip(skip).take(limit);

    return query.getManyAndCount();
  }

  @LogServiceCall()
  async update(id: string, data: Record<string, unknown>): Promise<Document | null> {
    await this.documentRepository.update(id, data);
    return this.findById(id, false);
  }

  @LogServiceCall()
  async delete(id: string): Promise<void> {
    const document = await this.findById(id);
    await this.neo4jService.deleteByDocumentId(id);
    await this.elasticsearchService.deleteByDocumentId(id);
    await this.documentRepository.delete(id);
    if (document?.storageKey) {
      try {
        await this.rustfsService.deleteFile(document.storageKey);
      } catch (error: unknown) {
        await this.redisService.lpush('cleanup:rustfs:pending', document.storageKey);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`对象存储删除失败，已加入补偿队列 - 文档ID: ${id}，错误: ${message}`);
      }
    }
  }

  @LogServiceCall()
  async updateStatus(id: string, status: DocumentStatus, errorMessage?: string): Promise<void> {
    await this.documentRepository.update(id, { status, errorMessage });
  }
}
