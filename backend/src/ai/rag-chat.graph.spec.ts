import { RagChatGraph } from './rag-chat.graph';

describe('RagChatGraph', () => {
  it('should pass the conversation ID to retrieval snapshots', async () => {
    const memoryService = {
      getRelevantMemories: jest.fn().mockResolvedValue([]),
    };
    const retrievalGraph = {
      retrieve: jest.fn().mockResolvedValue({ chunks: [], graphEvidence: [] }),
    };
    const graph = new RagChatGraph(
      { get: jest.fn().mockReturnValue('false') } as never,
      {} as never,
      {} as never,
      memoryService as never,
      retrievalGraph as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const retrieveContext = (
      graph as unknown as {
        retrieveContext(state: unknown): Promise<{ memories: unknown[]; chunks: unknown[]; graphEvidence: unknown[] }>;
      }
    ).retrieveContext.bind(graph);

    await expect(
      retrieveContext({
        conversationId: 'conversation-1',
        retrievalQuery: '测试查询',
        documentIds: ['doc-1'],
        userId: 'user-1',
        intent: 'knowledge',
      }),
    ).resolves.toEqual({ memories: [], chunks: [], graphEvidence: [] });
    expect(retrievalGraph.retrieve).toHaveBeenCalledWith('测试查询', ['doc-1'], {
      conversationId: 'conversation-1',
    });
  });
});
