import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import type { Relation } from 'typeorm';
import { Chunk } from './chunk.entity';

export enum FileType {
  PDF = 'pdf',
  DOCX = 'docx',
  DOC = 'doc',
  XLSX = 'xlsx',
  CSV = 'csv',
  XLS = 'xls',
  PPTX = 'pptx',
  PPT = 'ppt',
  TXT = 'txt',
  MD = 'md',
  JSON = 'json',
  URL = 'url',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
}

export enum DocumentStatus {
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ProcessingStage {
  QUEUED = 'queued',
  EXTRACTING = 'extracting',
  CHUNKING = 'chunking',
  EMBEDDING = 'embedding',
  INDEXING = 'indexing',
  GRAPHING = 'graphing',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

export enum NovelGraphStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
  STALE = 'stale',
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', enum: FileType })
  type: FileType;

  @Column({ type: 'varchar', nullable: true })
  path: string;

  @Column({ type: 'varchar', nullable: true })
  storageKey: string;

  @Column({ type: 'text', nullable: true })
  url: string;

  @Column({
    type: 'varchar',
    enum: DocumentStatus,
    default: DocumentStatus.UPLOADING,
  })
  status: DocumentStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'varchar', nullable: true })
  errorCode: string;

  @Column({ type: 'varchar', enum: ProcessingStage, default: ProcessingStage.QUEUED })
  processingStage: ProcessingStage;

  @Column({ type: 'integer', default: 0 })
  retryCount: number;

  @Column({ type: 'varchar', default: '2' })
  parserVersion: string;

  @Column({ type: 'varchar', nullable: true })
  contentHash: string;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'integer', default: 0 })
  chunkCount: number;

  @Column({ type: 'varchar', default: NovelGraphStatus.PENDING })
  graphStatus: NovelGraphStatus;

  @Column({ type: 'varchar', nullable: true })
  graphVersion: string | null;

  @Column({ type: 'text', nullable: true })
  graphError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  graphUpdatedAt: Date | null;

  @Column({ type: 'bigint', default: 0 })
  fileSize: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => Chunk, (chunk) => chunk.document)
  chunks: Relation<Chunk[]>;
}
