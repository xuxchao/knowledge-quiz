import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import { Document } from './document.entity';

@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Document, document => document.chunks, { onDelete: 'CASCADE' })
  document: Document;

  @Column({ type: 'varchar', length: 36 })
  documentId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'integer' })
  chunkIndex: number;

  @Column({ type: 'integer', default: 500 })
  tokenCount: number;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  embedding: string;

  @Index({ fulltext: true })
  @Column({ type: 'text', nullable: true })
  contentSearch: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
