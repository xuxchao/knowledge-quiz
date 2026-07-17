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
    const graphEvidence = {
      documentId: 'doc-1',
      documentName: '文档',
      statement: '图谱关系',
      evidenceChunkIds: ['chunk-2'],
      confidence: 0.7,
    };
    const graphChunk = {
      ...keywordHit,
      chunkId: 'chunk-2',
      content: '图谱证据正文',
      chunkIndex: 1,
      score: 0.7,
    };
    const final = [...selected, graphChunk];
    const retrievalService = {
      normalizeQuery: jest.fn().mockReturnValue('测试查询'),
      analyzeNovelQuery: jest.fn().mockResolvedValue({ mode: 'hybrid', entities: [], relationshipKinds: [] }),
      embedQuery: jest.fn().mockResolvedValue([0.1]),
      searchVector: jest.fn().mockRejectedValue(new Error('neo4j unavailable')),
      searchKeyword: jest.fn().mockResolvedValue([keywordHit]),
      searchGraph: jest.fn().mockResolvedValue([graphEvidence]),
      fuse: jest.fn().mockReturnValue(selected),
      rerank: jest.fn().mockResolvedValue(selected),
      selectAndExpand: jest.fn().mockResolvedValue(selected),
      attachGraphEvidence: jest.fn().mockResolvedValue(final),
    };

    const retrievalSnapshotService = { write: jest.fn().mockResolvedValue(undefined) };
    const graph = new RetrievalGraph(retrievalService as never, retrievalSnapshotService as never);

    await expect(graph.retrieve('  测试查询  ', ['doc-1'], { conversationId: 'conversation-1' })).resolves.toEqual({
      chunks: final,
      graphEvidence: [graphEvidence],
    });
    expect(retrievalService.searchKeyword).toHaveBeenCalledWith('测试查询', ['doc-1']);
    expect(retrievalService.fuse).toHaveBeenCalledWith([], [keywordHit]);
    expect(retrievalSnapshotService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        query: '  测试查询  ',
        normalizedQuery: '测试查询',
        errors: ['vector:neo4j unavailable'],
        stages: expect.objectContaining({
          postgresVector: [],
          elasticsearch: [keywordHit],
          neo4j: [graphEvidence],
          fused: selected,
          reranked: selected,
          selectAndExpand: selected,
          final,
        }),
      }),
    );
  });

  it('should fail with a recognizable error when both retrieval backends fail', async () => {
    const retrievalService = {
      normalizeQuery: jest.fn().mockReturnValue('测试'),
      analyzeNovelQuery: jest.fn().mockResolvedValue({ mode: 'text', entities: [], relationshipKinds: [] }),
      embedQuery: jest.fn().mockResolvedValue([0.1]),
      searchVector: jest.fn().mockRejectedValue(new Error('neo4j unavailable')),
      searchKeyword: jest.fn().mockRejectedValue(new Error('es unavailable')),
      searchGraph: jest.fn().mockResolvedValue([]),
      fuse: jest.fn(),
      rerank: jest.fn(),
      selectAndExpand: jest.fn(),
      attachGraphEvidence: jest.fn(),
    };

    const retrievalSnapshotService = { write: jest.fn().mockResolvedValue(undefined) };
    const graph = new RetrievalGraph(retrievalService as never, retrievalSnapshotService as never);

    await expect(graph.retrieve('测试')).rejects.toThrow('知识库检索服务暂时不可用');
    expect(retrievalService.fuse).not.toHaveBeenCalled();
    expect(retrievalSnapshotService.write).not.toHaveBeenCalled();
  });
});
