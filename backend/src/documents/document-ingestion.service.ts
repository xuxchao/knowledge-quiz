import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Job, Queue, Worker } from 'bullmq';
import { DocumentStatus, ProcessingStage } from '../entities/document.entity';
import { LoggerService, LogServiceCall } from '../common/logger';
import { FileProcessorService } from '../infrastructure/file-processor/file-processor.service';
import { DocumentService } from './document.service';
import { ChunkService } from './chunk.service';
import { requestContext } from '../common/logger/request-context';

interface IngestionJob {
  documentId: string;
  filePath: string;
  fileName: string;
  contentHash: string;
  parserVersion: string;
  traceId?: string;
}

export interface IngestionStatus {
  jobId?: string;
  state: string;
  stage: ProcessingStage;
  progress: number;
  retryCount: number;
  failedReason?: string;
}

@Injectable()
export class DocumentIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(DocumentIngestionService.name);
  private readonly queueName = 'document-ingestion-v2';
  private readonly parserVersion: string;
  private readonly connection: { host: string; port: number; password?: string; db: number };
  private queue: Queue<IngestionJob>;
  private worker: Worker<IngestionJob>;

  constructor(
    configService: ConfigService,
    private readonly documentService: DocumentService,
    private readonly chunkService: ChunkService,
    private readonly fileProcessorService: FileProcessorService,
  ) {
    this.parserVersion = configService.get<string>('RAG_PARSER_VERSION', '2');
    this.connection = {
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
      password: configService.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(configService.get<string>('REDIS_DB', '0')),
    };
  }

  onModuleInit(): void {
    this.queue = new Queue<IngestionJob>(this.queueName, { connection: this.connection });
    this.worker = new Worker<IngestionJob>(
      this.queueName,
      (job) => {
        const requestId = job.id ?? job.data.documentId;
        return requestContext.run({ requestId, traceId: job.data.traceId || requestId }, () => this.process(job));
      },
      {
        connection: this.connection,
        concurrency: Number(process.env.INGESTION_CONCURRENCY || 2),
        lockDuration: Number(process.env.INGESTION_LOCK_DURATION_MS || 300000),
      },
    );
    this.worker.on('failed', (job, error) => void this.handleFailedJob(job, error));
    this.worker.on('error', (error) => this.logger.error(`摄取Worker异常 - 错误: ${error.message}`, error.stack));
    this.logger.info(`文档摄取队列初始化完成 - 并发数: ${Number(process.env.INGESTION_CONCURRENCY || 2)}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.logger.info('文档摄取队列已关闭');
  }

  @LogServiceCall()
  async enqueue(documentId: string, filePath: string, fileName: string, contentHash?: string): Promise<string> {
    const hash = contentHash || createHash('sha256').update(filePath).digest('hex');
    const jobId = createHash('sha256').update(`${documentId}|${hash}|${this.parserVersion}`).digest('hex');
    await this.documentService.update(documentId, {
      status: DocumentStatus.PROCESSING,
      processingStage: ProcessingStage.QUEUED,
      parserVersion: this.parserVersion,
      contentHash: hash,
      retryCount: 0,
      errorCode: null,
      errorMessage: null,
    });
    const job = await this.queue.add(
      'ingest',
      {
        documentId,
        filePath,
        fileName,
        contentHash: hash,
        parserVersion: this.parserVersion,
        traceId: requestContext.get()?.traceId,
      },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: false,
      },
    );
    return job.id ?? jobId;
  }

  @LogServiceCall()
  async getStatus(documentId: string): Promise<IngestionStatus | null> {
    const document = await this.documentService.findById(documentId, false);
    if (!document) return null;
    const jobId = document.contentHash
      ? createHash('sha256').update(`${documentId}|${document.contentHash}|${document.parserVersion}`).digest('hex')
      : undefined;
    const job = jobId ? await this.queue.getJob(jobId) : undefined;
    return {
      jobId: job?.id,
      state: job ? await job.getState() : document.status,
      stage: document.processingStage,
      progress:
        typeof job?.progress === 'number' ? job.progress : document.status === DocumentStatus.PROCESSED ? 100 : 0,
      retryCount: document.retryCount,
      failedReason: job?.failedReason || document.errorMessage || undefined,
    };
  }

  private async process(job: Job<IngestionJob>): Promise<void> {
    const document = await this.documentService.findById(job.data.documentId);
    if (!document) return;
    await this.chunkService.cleanupDocument(document.id);

    await this.setStage(document.id, ProcessingStage.EXTRACTING, 10, job);
    const parsed = await this.fileProcessorService.processFile(job.data.filePath, job.data.fileName, document.type);
    if (!parsed.text.trim() || parsed.sections.length === 0) throw new Error('文档未提取到可索引内容');
    const pageCount = Number(parsed.metadata.pageCount || 0);
    if (pageCount > Number(process.env.RAG_MAX_PAGES || 1000)) throw new Error('文档页数超过处理限制');

    await this.setStage(document.id, ProcessingStage.CHUNKING, 35, job);
    const chunks = await this.fileProcessorService.splitSections(parsed.sections);
    if (chunks.length === 0) throw new Error('文档未生成有效分块');
    if (chunks.length > Number(process.env.RAG_MAX_CHUNKS || 10000)) throw new Error('文档分块数超过处理限制');
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    if (totalTokens > Number(process.env.RAG_MAX_TOKENS || 2000000)) throw new Error('文档Token总数超过处理限制');

    await this.setStage(document.id, ProcessingStage.EMBEDDING, 55, job);
    const enriched = await this.fileProcessorService.storeChunks(document.id, chunks, document.name);
    await this.setStage(document.id, ProcessingStage.INDEXING, 80, job);
    await this.chunkService.createForDocument(document.id, enriched);

    await this.documentService.update(document.id, {
      status: DocumentStatus.PROCESSED,
      processingStage: ProcessingStage.PROCESSED,
      metadata: parsed.metadata,
      chunkCount: enriched.length,
      processedAt: new Date(),
      errorMessage: null,
      errorCode: null,
    });
    await job.updateProgress(100);
    this.logger.info(`文档后台处理完成 - 文档ID: ${document.id}, 分块数: ${enriched.length}`);
  }

  private async setStage(documentId: string, stage: ProcessingStage, progress: number, job: Job): Promise<void> {
    await this.documentService.update(documentId, { processingStage: stage, retryCount: job.attemptsMade });
    await job.updateProgress(progress);
  }

  private async handleFailedJob(job: Job<IngestionJob> | undefined, error: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await this.chunkService.cleanupDocument(job.data.documentId);
    } catch (cleanupError: unknown) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      this.logger.error(
        `失败任务索引清理不完整 - 文档ID: ${job.data.documentId}，错误: ${cleanupMessage}`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }
    await this.documentService.update(job.data.documentId, {
      status: DocumentStatus.FAILED,
      processingStage: ProcessingStage.FAILED,
      retryCount: job.attemptsMade,
      errorCode: 'INGESTION_FAILED',
      errorMessage: error.message,
    });
    this.logger.error(`文档摄取最终失败 - 文档ID: ${job.data.documentId}，错误: ${error.message}`, error.stack);
  }
}
