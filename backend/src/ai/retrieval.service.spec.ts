import { RetrievalService } from './retrieval.service';

describe('RetrievalService', () => {
  it('should fuse vector and keyword hits and fall back to RRF when reranking is not configured', async () => {
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const aiService = { generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]) };
    const neo4jService = {
      search: jest.fn().mockResolvedValue([
        {
          content: '向量内容',
          metadata: { chunkId: 'chunk-1', documentId: 'doc-1', documentName: '文档', chunkIndex: 0 },
          score: 0.9,
        },
      ]),
    };
    const elasticsearchService = {
      search: jest.fn().mockResolvedValue([
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          documentName: '文档',
          content: '关键词内容',
          chunkIndex: 0,
          score: 10,
          metadata: {},
        },
        {
          chunkId: 'chunk-2',
          documentId: 'doc-1',
          documentName: '文档',
          content: '第二内容',
          chunkIndex: 1,
          score: 8,
          metadata: {},
        },
      ]),
    };
    const configService = { get: jest.fn((_key: string, fallback?: string) => fallback) };
    const service = new RetrievalService(
      repository as never,
      aiService as never,
      neo4jService as never,
      elasticsearchService as never,
      configService as never,
    );

    const result = await service.retrieve('  测试   查询  ');

    expect(aiService.generateEmbedding).toHaveBeenCalledWith('测试 查询');
    expect(neo4jService.search).toHaveBeenCalledWith([0.1, 0.2], 30, undefined);
    expect(elasticsearchService.search).toHaveBeenCalledWith('测试 查询', 30, undefined);
    expect(result.map((item) => item.chunkId)).toEqual(expect.arrayContaining(['chunk-1', 'chunk-2']));
    expect(result[0].chunkId).toBe('chunk-1');
  });
});
