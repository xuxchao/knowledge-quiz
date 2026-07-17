import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GraphRun, GraphRunStatus } from '../entities/graph-run.entity';
import { LoggerService, LogServiceCall } from '../common/logger';

export interface CreateGraphRunInput {
  graphName: string;
  aggregateId: string;
  idempotencyKey: string;
  input: Record<string, unknown>;
}

@Injectable()
export class GraphRunService {
  private readonly logger = new LoggerService(GraphRunService.name);
  private readonly leaseMs: number;

  constructor(
    @InjectRepository(GraphRun) private readonly repository: Repository<GraphRun>,
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.leaseMs = Number(configService.get<string>('GRAPH_WORKER_LEASE_MS', '300000'));
  }

  @LogServiceCall()
  async create(input: CreateGraphRunInput): Promise<GraphRun> {
    const existing = await this.repository.findOne({
      where: { graphName: input.graphName, idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;

    try {
      return await this.repository.save(
        this.repository.create({
          ...input,
          status: GraphRunStatus.QUEUED,
        }),
      );
    } catch (error: unknown) {
      const duplicate = await this.repository.findOne({
        where: { graphName: input.graphName, idempotencyKey: input.idempotencyKey },
      });
      if (duplicate) return duplicate;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `创建图运行失败 - 聚合ID: ${input.aggregateId}，错误: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @LogServiceCall()
  findByAggregate(graphName: string, aggregateId: string): Promise<GraphRun | null> {
    return this.repository.findOne({ where: { graphName, aggregateId }, order: { createdAt: 'DESC' } });
  }

  @LogServiceCall()
  async claimNext(graphName: string, workerId: string): Promise<GraphRun | null> {
    return this.dataSource.transaction(async (manager) => {
      const [rows] = await manager.query<[GraphRun[], number]>(
        `
          WITH candidate AS (
            SELECT "id"
            FROM "graph_runs"
            WHERE "graphName" = $1
              AND "availableAt" <= now()
              AND ("status" = 'queued' OR ("status" = 'running' AND "leaseExpiresAt" < now()))
            ORDER BY "availableAt" ASC, "createdAt" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE "graph_runs" run
          SET "status" = 'running', "leaseOwner" = $2,
              "leaseExpiresAt" = now() + ($3 * interval '1 millisecond'), "updatedAt" = now()
          FROM candidate
          WHERE run."id" = candidate."id"
          RETURNING run.*
        `,
        [graphName, workerId, this.leaseMs],
      );
      return rows[0] ?? null;
    });
  }

  @LogServiceCall()
  async heartbeat(runId: string, workerId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(GraphRun)
      .set({ leaseExpiresAt: () => `CURRENT_TIMESTAMP + (${this.leaseMs} * interval '1 millisecond')` })
      .where('id = :runId AND leaseOwner = :workerId AND status = :status', {
        runId,
        workerId,
        status: GraphRunStatus.RUNNING,
      })
      .execute();
  }

  @LogServiceCall()
  async updateNode(runId: string, lastNode: string, progress: number): Promise<void> {
    await this.repository.update(runId, { lastNode, progress });
  }

  @LogServiceCall()
  async complete(runId: string): Promise<void> {
    await this.repository.update(runId, {
      status: GraphRunStatus.SUCCEEDED,
      progress: 100,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null,
    });
  }

  @LogServiceCall()
  async retryOrFail(run: GraphRun, error: Error, maxAttempts: number): Promise<boolean> {
    const attemptCount = run.attemptCount + 1;
    if (attemptCount >= maxAttempts) {
      await this.repository.update(run.id, {
        status: GraphRunStatus.FAILED,
        attemptCount,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: 'GRAPH_RUN_FAILED',
        errorMessage: error.message,
      });
      return false;
    }

    await this.repository.update(run.id, {
      status: GraphRunStatus.QUEUED,
      attemptCount,
      availableAt: () => `CURRENT_TIMESTAMP + (${2000 * 2 ** (attemptCount - 1)} * interval '1 millisecond')`,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: 'GRAPH_RUN_RETRY',
      errorMessage: error.message,
    });
    return true;
  }

  @LogServiceCall()
  async releaseExpired(): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(GraphRun)
      .set({ status: GraphRunStatus.QUEUED, leaseOwner: null, leaseExpiresAt: null })
      .where('status = :status AND "leaseExpiresAt" < CURRENT_TIMESTAMP', { status: GraphRunStatus.RUNNING })
      .execute();
    return result.affected ?? 0;
  }

  @LogServiceCall()
  async recoverClockSkewedRuns(): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(GraphRun)
      .set({ availableAt: () => 'CURRENT_TIMESTAMP' })
      .where('status = :status AND "availableAt" > CURRENT_TIMESTAMP + interval \'5 minutes\'', {
        status: GraphRunStatus.QUEUED,
      })
      .execute();
    return result.affected ?? 0;
  }

  @LogServiceCall()
  async cleanupExpired(retentionDays: number): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT "id" FROM "graph_runs"
         WHERE "status" IN ('succeeded', 'failed')
           AND "updatedAt" < now() - ($1 * interval '1 day')`,
        [retentionDays],
      );
      const runIds = rows.map((row) => row.id);
      if (!runIds.length) return 0;
      await manager.query('DELETE FROM "langgraph"."checkpoint_writes" WHERE "thread_id" = ANY($1::text[])', [runIds]);
      await manager.query('DELETE FROM "langgraph"."checkpoint_blobs" WHERE "thread_id" = ANY($1::text[])', [runIds]);
      await manager.query('DELETE FROM "langgraph"."checkpoints" WHERE "thread_id" = ANY($1::text[])', [runIds]);
      await manager.query('DELETE FROM "graph_runs" WHERE "id" = ANY($1::uuid[])', [runIds]);
      return runIds.length;
    });
  }
}
