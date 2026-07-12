import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentStatus } from '../entities/document.entity';
import { LoggerService, LogServiceCall } from '../common/logger';
import { RedisService } from '../infrastructure/redis/redis.service';
import { FileProcessorService } from '../infrastructure/file-processor/file-processor.service';
import { DocumentService } from './document.service';
import { ChunkService } from './chunk.service';
import { RustfsService } from '../infrastructure/rustfs/rustfs.service';
import { requestContext } from '../common/logger/request-context';

interface IngestionJob {
  id: string;
  documentId: string;
  filePath: string;
  fileName: string;
  traceId?: string;
}

@Injectable()
export class DocumentIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(DocumentIngestionService.name);
  private readonly queueKey = 'ingestion:documents:pending';
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private redisService: RedisService,
    private documentService: DocumentService,
    private chunkService: ChunkService,
    private fileProcessorService: FileProcessorService,
    private rustfsService: RustfsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processNext(), 500);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @LogServiceCall()
  async enqueue(documentId: string, filePath: string, fileName: string): Promise<string> {
    const job: IngestionJob = {
      id: randomUUID(),
      documentId,
      filePath,
      fileName,
      traceId: requestContext.get()?.traceId,
    };
    await this.redisService.lpush(this.queueKey, JSON.stringify(job));
    return job.id;
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.processStorageCleanup();
      const payload = await this.redisService.rpop(this.queueKey);
      if (!payload) return;
      const job = JSON.parse(payload) as IngestionJob;
      await requestContext.run({ requestId: job.id, traceId: job.traceId || job.id }, () => this.process(job));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`摄取队列消费失败 - 错误: ${message}`, error instanceof Error ? error.stack : undefined);
    } finally {
      this.processing = false;
    }
  }

  private async processStorageCleanup(): Promise<void> {
    const key = 'cleanup:rustfs:pending';
    const storageKey = await this.redisService.rpop(key);
    if (!storageKey) return;
    try {
      await this.rustfsService.deleteFile(storageKey);
    } catch (error: unknown) {
      await this.redisService.lpush(key, storageKey);
      throw error;
    }
  }

  private async process(job: IngestionJob): Promise<void> {
    const document = await this.documentService.findById(job.documentId);
    if (!document) return;

    try {
      const { text, metadata } = await this.fileProcessorService.processFile(job.filePath, job.fileName, document.type);
      const chunks = await this.fileProcessorService.splitText(text);
      const enriched = await this.fileProcessorService.storeChunks(document.id, chunks, document.name);
      await this.chunkService.createForDocument(document.id, enriched);
      await this.documentService.update(document.id, {
        status: DocumentStatus.PROCESSED,
        metadata,
        chunkCount: enriched.length,
        errorMessage: null,
      });
      this.logger.info(`文档后台处理完成 - 文档ID: ${document.id}, 分块数: ${enriched.length}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.chunkService.cleanupDocument(document.id);
      await this.documentService.updateStatus(document.id, DocumentStatus.FAILED, message);
      this.logger.error(
        `文档后台处理失败 - 文档ID: ${document.id}，错误: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
