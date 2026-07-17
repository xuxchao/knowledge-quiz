import { PostgresVectorService } from './postgres-vector.service';

describe('PostgresVectorService', () => {
  it('should ensure the cosine HNSW index during module initialization', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const service = new PostgresVectorService(
      dataSource as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );

    await service.onModuleInit();

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('USING hnsw'));
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('vector_cosine_ops'));
  });

  it('should report whether the cosine HNSW index exists', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ exists: true }]) };
    const service = new PostgresVectorService(
      dataSource as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );

    await expect(service.hasCosineHnswIndex()).resolves.toBe(true);
  });

  it('should execute a cosine query with document filtering', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          chunkId: 'chunk-1',
          documentId: '11111111-1111-4111-8111-111111111111',
          content: '正文',
          chunkIndex: 0,
          metadata: { chapterOrdinal: 1 },
          documentName: '小说',
          score: '0.91',
        },
      ]),
    };
    const service = new PostgresVectorService(
      dataSource as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );
    const embedding = Array.from({ length: 1536 }, () => 0.01);

    const result = await service.search(embedding, 5, ['11111111-1111-4111-8111-111111111111']);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringMatching(/d\."id" = c\."documentId"[\s\S]*cardinality\(\$2::uuid\[\]\)/),
      [expect.stringMatching(/^\[0\.01,/), ['11111111-1111-4111-8111-111111111111'], 5],
    );
    expect(result).toEqual([
      expect.objectContaining({ score: 0.91, metadata: expect.objectContaining({ chunkId: 'chunk-1' }) }),
    ]);
  });

  it('should reject embeddings with the wrong dimensions', async () => {
    const service = new PostgresVectorService(
      { query: jest.fn() } as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );

    await expect(service.search([0.1, 0.2])).rejects.toThrow('期望1536维');
  });
});
