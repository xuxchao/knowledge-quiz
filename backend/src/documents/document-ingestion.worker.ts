import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { GraphRunService } from '../graph/graph-run.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { DocumentIngestionGraph } from './document-ingestion.graph';
import { DocumentIngestionService } from './document-ingestion.service';
import { GraphCheckpointService } from '../graph/graph-checkpoint.service';

@Injectable()
export class DocumentIngestionWorker {
  private readonly logger = new LoggerService(DocumentIngestionWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly retentionDays: number;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly graphRunService: GraphRunService,
    private readonly graph: DocumentIngestionGraph,
    private readonly checkpointService: GraphCheckpointService,
  ) {
    this.pollMs = Number(configService.get<string>('GRAPH_WORKER_POLL_MS', '1000'));
    this.heartbeatMs = Number(configService.get<string>('GRAPH_WORKER_HEARTBEAT_MS', '30000'));
    this.maxAttempts = Number(configService.get<string>('GRAPH_WORKER_MAX_ATTEMPTS', '3'));
    this.concurrency = Number(configService.get<string>('GRAPH_WORKER_CONCURRENCY', '2'));
    this.retentionDays = Number(configService.get<string>('GRAPH_CHECKPOINT_RETENTION_DAYS', '7'));
  }

  @LogServiceCall()
  async start(): Promise<void> {
    this.running = true;
    await this.checkpointService.get();
    const cleaned = await this.graphRunService.cleanupExpired(this.retentionDays);
    this.logger.info(
      `文档摄取LangGraph Worker已启动 - WorkerID: ${this.workerId}，并发数: ${this.concurrency}，清理运行数: ${cleaned}`,
    );
    await Promise.all(Array.from({ length: this.concurrency }, (_value, index) => this.runLoop(index)));
    this.logger.info('文档摄取LangGraph Worker已停止');
  }

  @LogServiceCall()
  stop(): void {
    this.running = false;
  }

  private async runLoop(slot: number): Promise<void> {
    while (this.running) {
      const slotWorkerId = `${this.workerId}:${slot}`;
      const run = await this.graphRunService.claimNext(DocumentIngestionService.GRAPH_NAME, slotWorkerId);
      if (!run) {
        await this.delay(this.pollMs);
        continue;
      }
      const heartbeat = setInterval(() => void this.graphRunService.heartbeat(run.id, slotWorkerId), this.heartbeatMs);
      try {
        await this.graph.execute(run);
        await this.graphRunService.complete(run.id);
      } catch (error: unknown) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`文档摄取图执行失败 - 运行ID: ${run.id}，错误: ${failure.message}`, failure.stack);
        const retrying = await this.graphRunService.retryOrFail(run, failure, this.maxAttempts);
        try {
          await this.graph.handleFailure(run, failure, retrying);
        } catch (cleanupError: unknown) {
          const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          this.logger.error(
            `文档摄取失败补偿异常 - 运行ID: ${run.id}，错误: ${message}`,
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
        }
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
