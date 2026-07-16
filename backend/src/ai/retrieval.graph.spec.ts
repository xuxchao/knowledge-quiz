import { RetrievalGraph } from './retrieval.graph';

describe('RetrievalGraph', () => {
  it('should use keyword results when vector search fails', async () => {
    const keywordHit = {
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      documentName: '文档',
      content: '关键词结果',
      chunkIndex: 0,
      score: 8,
      metadata: {},
    };
    const selected = [{ ...keywordHit, score: 0.8 }];
    const retrievalService = {
      normalizeQuery: jest.fn().mockReturnValue('测试查询'),
      embedQuery: jest.fn().mockResolvedValue([0.1]),
      searchVector: jest.fn().mockRejectedValue(new Error('neo4j unavailable')),
      searchKeyword: jest.fn().mockResolvedValue([keywordHit]),
      fuse: jest.fn().mockReturnValue(selected),
      rerank: jest.fn().mockResolvedValue(selected),
      selectAndExpand: jest.fn().mockResolvedValue(selected),
    };

    const graph = new RetrievalGraph(retrievalService as never);

    await expect(graph.retrieve('  测试查询  ', ['doc-1'])).resolves.toEqual(selected);
    expect(retrievalService.searchKeyword).toHaveBeenCalledWith('测试查询', ['doc-1']);
    expect(retrievalService.fuse).toHaveBeenCalledWith([], [keywordHit]);
  });

  it('should fail with a recognizable error when both retrieval backends fail', async () => {
    const retrievalService = {
      normalizeQuery: jest.fn().mockReturnValue('测试'),
      embedQuery: jest.fn().mockResolvedValue([0.1]),
      searchVector: jest.fn().mockRejectedValue(new Error('neo4j unavailable')),
      searchKeyword: jest.fn().mockRejectedValue(new Error('es unavailable')),
      fuse: jest.fn(),
      rerank: jest.fn(),
      selectAndExpand: jest.fn(),
    };

    const graph = new RetrievalGraph(retrievalService as never);

    await expect(graph.retrieve('测试')).rejects.toThrow('知识库检索服务暂时不可用');
    expect(retrievalService.fuse).not.toHaveBeenCalled();
  });
});
