import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from '../entities/document.entity';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { LoggerService, LogServiceCall } from '../common/logger';

@Injectable()
export class DocumentService {
  private readonly logger = new LoggerService(DocumentService.name);

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private neo4jService: Neo4jService,
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
    await this.documentRepository.delete(id);
    await this.neo4jService.deleteByDocumentId(id);
  }

  @LogServiceCall()
  async updateStatus(id: string, status: DocumentStatus, errorMessage?: string): Promise<void> {
    await this.documentRepository.update(id, { status, errorMessage });
  }
}
