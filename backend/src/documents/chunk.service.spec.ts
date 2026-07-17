import { ChunkService } from './chunk.service';

describe('ChunkService consistency', () => {
  const chunk = {
    id: 'chunk-1',
    documentId: 'doc-1',
    content: 'old',
    contentSearch: 'old',
    tokenCount: 3,
    embedding: [0.1],
    metadata: { chunkIndex: 0 },
  };

  let repository: Record<string, jest.Mock>;
  let manager: Record<string, jest.Mock>;
  let neo4jService: Record<string, jest.Mock>;
  let aiService: Record<string, jest.Mock>;
  let service: ChunkService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue({ ...chunk }),
      save: jest.fn().mockImplementation((value) => value),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    manager = {
      getRepository: jest.fn().mockReturnValue(repository),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const dataSource = {
      transaction: jest.fn().mockImplementation((callback) => callback(manager)),
    };
    aiService = { generateEmbeddings: jest.fn().mockResolvedValue([[0.2, 0.3]]) };
    neo4jService = {
      addDocuments: jest.fn().mockResolvedValue(undefined),
      deleteByChunkId: jest.fn().mockResolvedValue(undefined),
    };
    const elasticsearchService = {
      indexChunks: jest.fn().mockResolvedValue(undefined),
      deleteByChunkId: jest.fn().mockResolvedValue(undefined),
      deleteByDocumentId: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChunkService(
      {} as never,
      dataSource as never,
      aiService as never,
      neo4jService as never,
      elasticsearchService as never,
      {
        extractAndStore: jest.fn().mockResolvedValue(undefined),
        markFailed: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  it('recomputes and synchronizes all searchable content when editing', async () => {
    const result = await service.updateContent('chunk-1', 'new content');

    expect(aiService.generateEmbeddings).toHaveBeenCalledWith(['new content']);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'new content', contentSearch: 'new content', embedding: [0.2, 0.3] }),
    );
    expect(result).toEqual(expect.objectContaining({ content: 'new content' }));
  });

  it('deletes the searchable chunk and decrements the document count atomically', async () => {
    await expect(service.delete('chunk-1')).resolves.toBe(true);

    expect(repository.delete).toHaveBeenCalledWith('chunk-1');
    const queryBuilder = manager.createQueryBuilder.mock.results[0].value;
    expect(queryBuilder.set).toHaveBeenCalledWith({ chunkCount: expect.any(Function) });
    expect(queryBuilder.where).toHaveBeenCalledWith('id = :documentId', { documentId: 'doc-1' });
  });

  it('reuses stable chunk ids when staging the same document again', async () => {
    const deleteQuery = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const stagingRepository = {
      find: jest.fn().mockResolvedValue([{ id: 'stable-id', documentId: 'doc-1', chunkIndex: 0 }]),
      createQueryBuilder: jest.fn().mockReturnValue(deleteQuery),
      create: jest.fn().mockImplementation((value) => value),
      save: jest.fn().mockImplementation((value) => value),
    };
    const stagingService = new ChunkService(
      {} as never,
      {
        transaction: jest
          .fn()
          .mockImplementation((callback) => callback({ getRepository: jest.fn().mockReturnValue(stagingRepository) })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await stagingService.stageForDocument(
      'doc-1',
      [
        {
          content: 'new content',
          metadata: {},
          embedding: [0.2],
          chunkIndex: 0,
          totalChunks: 1,
        },
      ],
      'run-2',
    );

    expect(result[0]).toEqual(expect.objectContaining({ id: 'stable-id', ingestionRunId: 'run-2' }));
  });
});
