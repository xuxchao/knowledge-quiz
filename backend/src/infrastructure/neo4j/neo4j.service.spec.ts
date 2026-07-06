import { ConfigService } from '@nestjs/config';
import { Neo4jService } from './neo4j.service';

describe('Neo4jService', () => {
  let service: Neo4jService;
  let session: { run: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    session = {
      run: jest.fn().mockResolvedValue({ records: [] }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    service = new Neo4jService({ get: jest.fn() } as unknown as ConfigService);
    (service as unknown as { driver: { session: jest.Mock } }).driver = {
      session: jest.fn().mockReturnValue(session),
    };
  });

  it('should store document metadata as Neo4j primitive properties', async () => {
    await service.addDocuments(
      [
        {
          content: 'chunk1',
          metadata: {
            documentId: 'doc-1',
            chunkIndex: 0,
            totalChunks: 2,
            tags: ['a', 'b'],
            mixed: ['a', 1],
            nested: { source: 'upload' },
            empty: null,
          },
        },
      ],
      [[0.1, 0.2]],
    );

    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining('SET c += $properties'),
      {
        properties: {
          content: 'chunk1',
          embedding: [0.1, 0.2],
          documentId: 'doc-1',
          chunkIndex: 0,
          totalChunks: 2,
          tags: ['a', 'b'],
          mixed: JSON.stringify(['a', 1]),
          nested: JSON.stringify({ source: 'upload' }),
        },
      },
    );
    expect(session.close).toHaveBeenCalled();
  });

  it('should delete chunks by top-level documentId property', async () => {
    await service.deleteByDocumentId('doc-1');

    expect(session.run).toHaveBeenCalledWith(expect.stringContaining('WHERE c.documentId = $documentId'), {
      documentId: 'doc-1',
    });
    expect(session.run).not.toHaveBeenCalledWith(expect.stringContaining('c.metadata.documentId'), expect.anything());
  });

  it('should reconstruct metadata from stored node properties when searching', async () => {
    session.run.mockResolvedValue({
      records: [
        {
          get: jest.fn((key: string) => {
            if (key === 'content') {
              return 'chunk1';
            }
            if (key === 'properties') {
              return {
                content: 'chunk1',
                embedding: [0.1, 0.2],
                documentId: 'doc-1',
                chunkIndex: 0,
                totalChunks: 2,
              };
            }
            if (key === 'score') {
              return 0.9;
            }
            return undefined;
          }),
        },
      ],
    });

    const result = await service.search([0.1, 0.2], 1);

    expect(result).toEqual([
      {
        content: 'chunk1',
        metadata: {
          documentId: 'doc-1',
          chunkIndex: 0,
          totalChunks: 2,
        },
        score: 0.9,
      },
    ]);
  });
});
