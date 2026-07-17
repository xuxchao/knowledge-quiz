import { ConfigService } from '@nestjs/config';
import { FileType, ProcessingStage } from '../entities/document.entity';
import { GraphRunStatus } from '../entities/graph-run.entity';
import { DocumentIngestionService } from './document-ingestion.service';

describe('DocumentIngestionService', () => {
  it('should create a deterministic graph run and expose the compatible status shape', async () => {
    const documentService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'doc-1', type: FileType.PDF, processingStage: ProcessingStage.QUEUED }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const graphRunService = {
      create: jest.fn().mockResolvedValue({ id: 'run-1', status: GraphRunStatus.QUEUED }),
      findByAggregate: jest.fn().mockResolvedValue({
        id: 'run-1',
        status: GraphRunStatus.RUNNING,
        progress: 55,
        attemptCount: 1,
        errorMessage: null,
      }),
    };
    const config = { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService;
    const service = new DocumentIngestionService(config, documentService as never, graphRunService as never);

    await expect(service.enqueue('doc-1', 'stored-url', 'doc.pdf', 'hash')).resolves.toBe('run-1');
    expect(graphRunService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        graphName: 'document-ingestion-v1',
        aggregateId: 'doc-1',
        input: expect.objectContaining({ fileType: FileType.PDF, contentHash: 'hash' }),
      }),
    );
    await expect(service.getStatus('doc-1')).resolves.toEqual({
      jobId: 'run-1',
      state: GraphRunStatus.RUNNING,
      stage: ProcessingStage.QUEUED,
      progress: 55,
      retryCount: 1,
      failedReason: undefined,
      graphStatus: undefined,
      graphVersion: undefined,
      graphError: undefined,
    });
  });

  it('should create a new idempotency key for every forced reindex', async () => {
    const documentService = {
      findById: jest.fn().mockResolvedValue({ id: 'doc-1', type: FileType.MD }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const graphRunService = {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: 'run-1', status: GraphRunStatus.QUEUED })
        .mockResolvedValueOnce({ id: 'run-2', status: GraphRunStatus.QUEUED }),
    };
    const config = { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService;
    const service = new DocumentIngestionService(config, documentService as never, graphRunService as never);

    await service.enqueue('doc-1', 'stored-url', 'novel.md', 'hash', true);
    await service.enqueue('doc-1', 'stored-url', 'novel.md', 'hash', true);

    const firstKey = graphRunService.create.mock.calls[0][0].idempotencyKey;
    const secondKey = graphRunService.create.mock.calls[1][0].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it('should not move a document back to processing when an idempotent run already succeeded', async () => {
    const documentService = {
      findById: jest.fn().mockResolvedValue({ id: 'doc-1', type: FileType.MD }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const graphRunService = {
      create: jest.fn().mockResolvedValue({ id: 'run-1', status: GraphRunStatus.SUCCEEDED }),
    };
    const config = { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService;
    const service = new DocumentIngestionService(config, documentService as never, graphRunService as never);

    await service.enqueue('doc-1', 'stored-url', 'novel.md', 'hash');

    expect(documentService.update).not.toHaveBeenCalled();
  });
});
