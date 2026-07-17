import { DocumentStatus, ProcessingStage } from '../entities/document.entity';
import { DocumentIngestionGraph } from './document-ingestion.graph';

describe('DocumentIngestionGraph', () => {
  it('should always mark the document failed when terminal compensation cleanup fails', async () => {
    const documentService = { update: jest.fn().mockResolvedValue(undefined) };
    const chunkService = { cleanupDocument: jest.fn().mockRejectedValue(new Error('index cleanup failed')) };
    const artifactService = { cleanup: jest.fn().mockRejectedValue(new Error('artifact cleanup failed')) };
    const graph = new DocumentIngestionGraph(
      {} as never,
      {} as never,
      documentService as never,
      chunkService as never,
      {} as never,
      artifactService as never,
      {} as never,
    );

    await graph.handleFailure(
      { id: 'run-1', aggregateId: 'doc-1', attemptCount: 2 } as never,
      new Error('terminal failure'),
      false,
    );

    expect(documentService.update).toHaveBeenCalledWith('doc-1', {
      status: DocumentStatus.FAILED,
      processingStage: ProcessingStage.FAILED,
      retryCount: 3,
      errorCode: 'INGESTION_FAILED',
      errorMessage: 'terminal failure',
    });
  });
});
