import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import type { Relation } from 'typeorm';
import { Document } from './document.entity';

@Entity('chunks')
@Index('IDX_chunks_document', ['documentId', 'chunkIndex'])
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Document, (document) => document.chunks, {
    onDelete: 'CASCADE',
  })
  document: Relation<Document>;

  @Column({ type: 'varchar' })
  documentId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'integer' })
  chunkIndex: number;

  @Column({ type: 'integer', default: 500 })
  tokenCount: number;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'integer', nullable: true })
  pageNumber: number;

  @Column({ type: 'varchar', nullable: true })
  sheetName: string;

  @Column({ type: 'varchar', nullable: true })
  rowRange: string;

  @Column({ type: 'integer', nullable: true })
  slideNumber: number;

  @Column({ type: 'json', nullable: true })
  headingPath: string[];

  @Column({ type: 'integer', nullable: true })
  startMs: number;

  @Column({ type: 'integer', nullable: true })
  endMs: number;

  @Column({ type: 'varchar', default: 'text-embedding-v2' })
  embeddingModel: string;

  @Column({ type: 'varchar', default: 'pending' })
  indexStatus: string;

  @Column({ type: 'text', nullable: true })
  embedding: string;

  @Index({ fulltext: true })
  @Column({ type: 'text', nullable: true })
  contentSearch: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
