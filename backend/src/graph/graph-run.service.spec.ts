import { ConfigService } from '@nestjs/config';
import { GraphRun, GraphRunStatus } from '../entities/graph-run.entity';
import { GraphRunService } from './graph-run.service';

describe('GraphRunService', () => {
  const configService = {
    get: jest.fn((_key: string, fallback?: string) => fallback),
  } as unknown as ConfigService;

  it('should return the claimed run from the TypeORM update result', async () => {
    const run = {
      id: 'run-1',
      graphName: 'document-ingestion-v1',
      aggregateId: 'document-1',
      status: GraphRunStatus.RUNNING,
      attemptCount: 0,
      input: { documentId: 'document-1' },
    } as GraphRun;
    const manager = {
      query: jest.fn().mockResolvedValue([[run], 1]),
    };
    const dataSource = {
      transaction: jest.fn((operation: (transactionManager: typeof manager) => Promise<GraphRun | null>) =>
        operation(manager),
      ),
    };
    const service = new GraphRunService({} as never, dataSource as never, configService);

    await expect(service.claimNext('document-ingestion-v1', 'worker-1')).resolves.toBe(run);
  });

  it('should let PostgreSQL assign availableAt when creating a run', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation((value) => Promise.resolve({ id: 'run-1', ...value })),
    };
    const service = new GraphRunService(repository as never, {} as never, configService);

    await service.create({
      graphName: 'document-ingestion-v1',
      aggregateId: 'document-1',
      idempotencyKey: 'key-1',
      input: {},
    });

    expect(repository.create).toHaveBeenCalledWith(expect.not.objectContaining({ availableAt: expect.anything() }));
  });

  it('should repair queued runs whose availability was shifted into the future', async () => {
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const repository = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
    const service = new GraphRunService(repository as never, {} as never, configService);

    await expect(service.recoverClockSkewedRuns()).resolves.toBe(2);
    expect(queryBuilder.set).toHaveBeenCalledWith({ availableAt: expect.any(Function) });
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining("CURRENT_TIMESTAMP + interval '5 minutes'"),
      { status: GraphRunStatus.QUEUED },
    );
  });
});
