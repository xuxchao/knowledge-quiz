import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DocumentStatus, ProcessingStage } from '../entities/document.entity';
import { GraphRunStatus } from '../entities/graph-run.entity';
import { GraphRunService } from '../graph/graph-run.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { DocumentService } from './document.service';

export interface IngestionStatus {
  jobId?: string;
  state: string;
  stage: ProcessingStage;
  progress: number;
  retryCount: number;
  failedReason?: string;
}

@Injectable()
export class DocumentIngestionService {
  static readonly GRAPH_NAME = 'document-ingestion-v1';
  private readonly logger = new LoggerService(DocumentIngestionService.name);
  private readonly parserVersion: string;

  constructor(
    configService: ConfigService,
    private readonly documentService: DocumentService,
    private readonly graphRunService: GraphRunService,
  ) {
    this.parserVersion = configService.get<string>('RAG_PARSER_VERSION', '2');
  }

  @LogServiceCall()
  async enqueue(documentId: string, filePath: string, fileName: string, contentHash?: string): Promise<string> {
    const document = await this.documentService.findById(documentId, false);
    if (!document) throw new Error('文档不存在');
    const hash = contentHash || createHash('sha256').update(filePath).digest('hex');
    const idempotencyKey = createHash('sha256').update(`${documentId}|${hash}|${this.parserVersion}`).digest('hex');
    await this.documentService.update(documentId, {
      status: DocumentStatus.PROCESSING,
      processingStage: ProcessingStage.QUEUED,
      parserVersion: this.parserVersion,
      contentHash: hash,
      retryCount: 0,
      errorCode: null,
      errorMessage: null,
    });
    const run = await this.graphRunService.create({
      graphName: DocumentIngestionService.GRAPH_NAME,
      aggregateId: documentId,
      idempotencyKey,
      input: {
        documentId,
        filePath,
        fileName,
        fileType: document.type,
        contentHash: hash,
        parserVersion: this.parserVersion,
      },
    });
    this.logger.info(`文档LangGraph运行已创建 - 文档ID: ${documentId}，运行ID: ${run.id}`);
    return run.id;
  }

  @LogServiceCall()
  async getStatus(documentId: string): Promise<IngestionStatus | null> {
    const document = await this.documentService.findById(documentId, false);
    if (!document) return null;
    const run = await this.graphRunService.findByAggregate(DocumentIngestionService.GRAPH_NAME, documentId);
    const state = run?.status ?? document.status;
    return {
      jobId: run?.id,
      state: state === GraphRunStatus.SUCCEEDED ? 'completed' : state,
      stage: document.processingStage,
      progress: run?.progress ?? (document.status === DocumentStatus.PROCESSED ? 100 : 0),
      retryCount: run?.attemptCount ?? document.retryCount,
      failedReason: run?.errorMessage || document.errorMessage || undefined,
    };
  }
}
