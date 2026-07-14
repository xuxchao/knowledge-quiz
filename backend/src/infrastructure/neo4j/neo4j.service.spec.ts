import { ConfigService } from '@nestjs/config';
import { Neo4jService } from './neo4j.service';

describe('Neo4jService', () => {
  let service: Neo4jService;
  let session: { run: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    session = {
      run: jest.fn((query: string) =>
        Promise.resolve({
          records: query.includes('SHOW VECTOR INDEXES')
            ? [
                {
                  get: jest.fn((key: string) => {
                    if (key === 'name') return 'document_embeddings_v2';
                    if (key === 'state') return 'ONLINE';
                    return undefined;
                  }),
                },
              ]
            : [],
        }),
      ),
      close: jest.fn().mockResolvedValue(undefined),
    };

    service = new Neo4jService({
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    } as unknown as ConfigService);
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
            chunkId: 'chunk-1',
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

    expect(session.run).toHaveBeenCalledWith(expect.stringContaining('UNWIND $rows'), {
      rows: [
        {
          properties: {
            content: 'chunk1',
            embedding: [0.1, 0.2],
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            chunkIndex: 0,
            totalChunks: 2,
            tags: ['a', 'b'],
            mixed: JSON.stringify(['a', 1]),
            nested: JSON.stringify({ source: 'upload' }),
          },
        },
      ],
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('should wait for the vector index to become online after creating it', async () => {
    await service.createVectorIndex();

    expect(session.run).toHaveBeenNthCalledWith(1, expect.stringContaining('CREATE VECTOR INDEX'));
    expect(session.run).toHaveBeenNthCalledWith(2, expect.stringContaining('SHOW VECTOR INDEXES'), {
      labelsOrTypes: ['DocumentChunk'],
      properties: ['embedding'],
    });
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

  it('should recreate a missing vector index and retry the search once', async () => {
    const missingIndexError = new Error('There is no such vector schema index: document_embeddings_v2');
    let vectorQueryCount = 0;
    session.run.mockImplementation((query: string) => {
      if (query.includes('db.index.vector.queryNodes')) {
        vectorQueryCount += 1;
        if (vectorQueryCount === 1) {
          return Promise.reject(missingIndexError);
        }
      }
      if (query.includes('SHOW VECTOR INDEXES')) {
        return Promise.resolve({
          records: [
            {
              get: jest.fn((key: string) => {
                if (key === 'name') return 'document_embeddings_v2';
                if (key === 'state') return 'ONLINE';
                return undefined;
              }),
            },
          ],
        });
      }
      return Promise.resolve({ records: [] });
    });

    await expect(service.search([0.1, 0.2], 1)).resolves.toEqual([]);

    expect(vectorQueryCount).toBe(2);
    expect(session.run).toHaveBeenCalledWith(expect.stringContaining('CREATE VECTOR INDEX'));
    expect(session.run).toHaveBeenCalledWith(expect.stringContaining('SHOW VECTOR INDEXES'), {
      labelsOrTypes: ['DocumentChunk'],
      properties: ['embedding'],
    });
  });

  it('should reuse an online legacy index with the same schema', async () => {
    session.run.mockImplementation((query: string) =>
      Promise.resolve({
        records: query.includes('SHOW VECTOR INDEXES')
          ? [
              {
                get: jest.fn((key: string) => {
                  if (key === 'name') return 'document_embeddings';
                  if (key === 'state') return 'ONLINE';
                  return undefined;
                }),
              },
            ]
          : [],
      }),
    );

    await service.createVectorIndex();
    await service.search([0.1, 0.2], 1);

    expect(session.run).toHaveBeenLastCalledWith(expect.stringContaining('db.index.vector.queryNodes'), {
      topK: 1,
      queryEmbedding: [0.1, 0.2],
      indexName: 'document_embeddings',
      documentIds: [],
    });
  });
});
