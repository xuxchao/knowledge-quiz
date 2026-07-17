import { DocumentIngestionWorker } from './document-ingestion.worker';

describe('DocumentIngestionWorker lifecycle', () => {
  const createWorker = (autoStart: string) => {
    const graphRunService = {
      cleanupExpired: jest.fn().mockResolvedValue(0),
      releaseExpired: jest.fn().mockResolvedValue(0),
      recoverClockSkewedRuns: jest.fn().mockResolvedValue(0),
      claimNext: jest.fn().mockResolvedValue(null),
    };
    const config = {
      get: jest.fn((key: string, fallback: string) =>
        key === 'INGESTION_WORKER_AUTOSTART'
          ? autoStart
          : key === 'GRAPH_WORKER_POLL_MS' || key === 'GRAPH_WORKER_CONCURRENCY'
            ? '1'
            : fallback,
      ),
    };
    const worker = new DocumentIngestionWorker(
      config as never,
      graphRunService as never,
      { execute: jest.fn() } as never,
      { get: jest.fn().mockResolvedValue({}) } as never,
    );
    return { worker, graphRunService };
  };

  it('should consume queued runs when the API application starts', async () => {
    const { worker, graphRunService } = createWorker('true');

    worker.onApplicationBootstrap();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await worker.onApplicationShutdown();

    expect(graphRunService.claimNext).toHaveBeenCalled();
  });

  it('should leave consumption to the standalone worker when autostart is disabled', async () => {
    const { worker, graphRunService } = createWorker('false');

    worker.onApplicationBootstrap();
    await worker.onApplicationShutdown();

    expect(graphRunService.claimNext).not.toHaveBeenCalled();
  });
});
