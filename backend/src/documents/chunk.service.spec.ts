import { ChunkService } from './chunk.service';

describe('ChunkService consistency', () => {
  const chunk = {
    id: 'chunk-1',
    documentId: 'doc-1',
    content: 'old',
    contentSearch: 'old',
    tokenCount: 3,
    embedding: '[0.1]',
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
      save: jest.fn().mockImplementation(async (value) => value),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
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
      transaction: jest.fn().mockImplementation(async (callback) => callback(manager)),
    };
    aiService = { generateEmbeddings: jest.fn().mockResolvedValue([[0.2, 0.3]]) };
    neo4jService = {
      addDocuments: jest.fn().mockResolvedValue(undefined),
      deleteByChunkId: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChunkService({} as never, dataSource as never, aiService as never, neo4jService as never);
  });

  it('recomputes and synchronizes all searchable content when editing', async () => {
    const result = await service.updateContent('chunk-1', 'new content');

    expect(aiService.generateEmbeddings).toHaveBeenCalledWith(['new content']);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'new content', contentSearch: 'new content', embedding: '[0.2,0.3]' }),
    );
    expect(neo4jService.addDocuments).toHaveBeenCalledWith(
      [{ content: 'new content', metadata: { chunkIndex: 0, chunkId: 'chunk-1', documentId: 'doc-1' } }],
      [[0.2, 0.3]],
    );
    expect(result).toEqual(expect.objectContaining({ content: 'new content' }));
  });

  it('deletes the vector node and decrements the document count atomically', async () => {
    await expect(service.delete('chunk-1')).resolves.toBe(true);

    expect(neo4jService.deleteByChunkId).toHaveBeenCalledWith('chunk-1');
    expect(repository.delete).toHaveBeenCalledWith('chunk-1');
    const queryBuilder = manager.createQueryBuilder.mock.results[0].value;
    expect(queryBuilder.set).toHaveBeenCalledWith({ chunkCount: expect.any(Function) });
    expect(queryBuilder.where).toHaveBeenCalledWith('id = :documentId', { documentId: 'doc-1' });
  });
});
