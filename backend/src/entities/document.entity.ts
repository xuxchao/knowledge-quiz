import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
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

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'integer', default: 0 })
  chunkCount: number;

  @Column({ type: 'bigint', default: 0 })
  fileSize: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => Chunk, (chunk) => chunk.document)
  chunks: Chunk[];
}
