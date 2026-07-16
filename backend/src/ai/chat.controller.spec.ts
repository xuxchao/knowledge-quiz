import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { RagChatGraph, RagChatStreamEvent } from './rag-chat.graph';

const writer = { write: jest.fn() };
let execution: Promise<void> = Promise.resolve();

jest.mock('ai', () => ({
  createUIMessageStream: jest.fn((options) => {
    execution = Promise.resolve(options.execute({ writer }));
    return 'ui-stream';
  }),
  pipeUIMessageStreamToResponse: jest.fn(),
}));

describe('ChatController', () => {
  let controller: ChatController;
  let graph: { stream: jest.Mock };

  beforeEach(async () => {
    graph = { stream: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: RagChatGraph, useValue: graph }],
    }).compile();
    controller = module.get(ChatController);
    writer.write.mockClear();
  });

  it('should preserve conversation, citation and text UI stream parts', async () => {
    graph.stream.mockImplementation(() =>
      thisStream([
        { type: 'conversation-id', conversationId: 'conv-1' },
        {
          type: 'citations',
          citations: [
            {
              documentId: 'doc-1',
              documentName: '产品说明.pdf',
              downloadUrl: '/api/documents/doc-1/download',
              chunkIndex: 2,
              content: '引用内容',
              score: 0.9,
            },
          ],
        },
        { type: 'token', token: '你好' },
        { type: 'final', response: '你好' },
      ]),
    );

    await controller.chat(
      {
        conversationId: 'conv-1',
        userId: 'user-1',
        messages: [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: '文档说了什么？' }] }],
      },
      { once: jest.fn(), writableEnded: false } as never,
    );
    await execution;

    expect(graph.stream).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', userId: 'user-1', message: '文档说了什么？' }),
      expect.any(AbortSignal),
    );
    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-conversation-id',
      data: { conversationId: 'conv-1' },
      transient: true,
    });
    expect(writer.write).toHaveBeenCalledWith(expect.objectContaining({ type: 'data-citations' }));
    expect(writer.write).toHaveBeenCalledWith(expect.objectContaining({ type: 'text-delta', delta: '你好' }));
    expect(writer.write).toHaveBeenCalledWith(expect.objectContaining({ type: 'text-end' }));
  });

  it('should reject an empty user message', async () => {
    await expect(controller.chat({ messages: [] }, {} as never)).rejects.toThrow('Message cannot be empty');
    expect(graph.stream).not.toHaveBeenCalled();
  });
});

async function* thisStream(events: RagChatStreamEvent[]): AsyncGenerator<RagChatStreamEvent> {
  for (const event of events) yield event;
}
