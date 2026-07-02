import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus } from '../entities/document.entity';
import { Neo4jService } from './neo4j.service';

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private neo4jService: Neo4jService,
  ) {}

  async create(data: Partial<Document>): Promise<Document> {
    const document = this.documentRepository.create(data);
    return this.documentRepository.save(document);
  }

  async findById(id: string): Promise<Document | null> {
    return this.documentRepository.findOne({
      where: { id },
      relations: { chunks: true },
    });
  }

  async findAll(
    name?: string,
    skip: number = 0,
    limit: number = 10,
  ): Promise<[Document[], number]> {
    const query = this.documentRepository.createQueryBuilder('document');

    if (name) {
      query.where('document.name LIKE :name', { name: `%${name}%` });
    }

    query.orderBy('document.createdAt', 'DESC');
    query.skip(skip).take(limit);

    return query.getManyAndCount();
  }

  async update(
    id: string,
    data: Record<string, unknown>,
  ): Promise<Document | null> {
    await this.documentRepository.update(id, data);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.documentRepository.delete(id);
    await this.neo4jService.deleteByDocumentId(id);
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    errorMessage?: string,
  ): Promise<void> {
    await this.documentRepository.update(id, { status, errorMessage });
  }
}
