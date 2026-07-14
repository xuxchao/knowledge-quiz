import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ConversationService } from '../conversations/conversation.service';
import { AiService } from './ai.service';
import { MemoryService } from '../memory/memory.service';
import { RetrievalService } from './retrieval.service';
import { LangfuseService } from '../infrastructure/langfuse/langfuse.service';
import { MessageRole } from '../entities/message.entity';
import { ConversationContextService } from './conversation-context.service';
import { TokenBudgetService } from './token-budget.service';

jest.mock('ai', () => ({
  createUIMessageStream: jest.fn((options) => {
    options.execute({
      writer: {
        write: jest.fn(),
        merge: jest.fn(),
      },
    });
    return 'ui-stream';
  }),
  pipeUIMessageStreamToResponse: jest.fn(),
}));

jest.mock('@ai-sdk/langchain', () => ({
  toUIMessageStream: jest.fn(() => 'langchain-ui-stream'),
}));

describe('ChatController', () => {
  let controller: ChatController;
  let conversationService: jest.Mocked<ConversationService>;
  let aiService: jest.Mocked<AiService>;
  let memoryService: jest.Mocked<MemoryService>;
  let retrievalService: jest.Mocked<RetrievalService>;
  let langfuseService: jest.Mocked<LangfuseService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ConversationService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'conv-1', title: '知识库检索' }),
            updateTitle: jest.fn().mockResolvedValue(undefined),
            createMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
            findOwnedById: jest.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1' }),
          },
        },
        {
          provide: AiService,
          useValue: {
            generateConversationTitle: jest.fn().mockResolvedValue('知识库检索'),
            generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
            streamConversation: jest.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () {},
            }),
          },
        },
        {
          provide: MemoryService,
          useValue: {
            saveUserMemory: jest.fn().mockResolvedValue(undefined),
            saveConversationMemory: jest.fn().mockResolvedValue(undefined),
            getRelevantMemories: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: RetrievalService,
          useValue: {
            retrieve: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: LangfuseService,
          useValue: {
            createChatHandler: jest.fn().mockReturnValue({ name: 'langfuse-handler' }),
            flush: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConversationContextService,
          useValue: {
            validateUserMessage: jest.fn().mockReturnValue(4),
            prepare: jest.fn().mockResolvedValue({
              messages: [{ role: 'user', content: '继续讲一下' }],
              estimatedTokens: 100,
              summarized: false,
            }),
          },
        },
        { provide: TokenBudgetService, useValue: { countText: jest.fn().mockReturnValue(4) } },
      ],
    }).compile();

    controller = module.get(ChatController);
    conversationService = module.get(ConversationService);
    aiService = module.get(AiService);
    memoryService = module.get(MemoryService);
    retrievalService = module.get(RetrievalService);
    langfuseService = module.get(LangfuseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate title when creating the first conversation', async () => {
    await controller.chat(
      {
        userId: 'user-1',
        messages: [
          {
            id: 'ui-msg-1',
            role: 'user',
            parts: [{ type: 'text', text: '怎么检索知识库里的内容？' }],
          },
        ],
      },
      {} as never,
    );

    expect(aiService.generateConversationTitle).toHaveBeenCalledWith('怎么检索知识库里的内容？', [
      { name: 'langfuse-handler' },
    ]);
    expect(conversationService.create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: '怎么检索知识库里的内容？',
    });
    expect(conversationService.updateTitle).toHaveBeenCalledWith('conv-1', '知识库检索');
    expect(conversationService.createMessage).toHaveBeenCalledWith(
      'conv-1',
      MessageRole.USER,
      '怎么检索知识库里的内容？',
      [],
      4,
    );
  });

  it('should attach the Langfuse callback to the complete LangChain stream', async () => {
    await controller.chat(
      {
        conversationId: 'conv-1',
        userId: 'user-1',
        messages: [
          {
            id: 'ui-msg-1',
            role: 'user',
            parts: [{ type: 'text', text: '继续讲一下' }],
          },
        ],
      },
      {} as never,
    );

    expect(aiService.generateConversationTitle).not.toHaveBeenCalled();
    expect(langfuseService.createChatHandler).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userId: 'user-1',
    });
    expect(aiService.streamConversation).toHaveBeenCalledWith(
      [{ role: 'user', content: '继续讲一下' }],
      expect.stringContaining('知识库内容'),
      [{ name: 'langfuse-handler' }],
    );
    expect(retrievalService.retrieve).toHaveBeenCalledWith('继续讲一下', undefined);
  });

  it('should persist retrieved document chunks as assistant references', async () => {
    retrievalService.retrieve.mockResolvedValue([
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        documentName: '产品说明.pdf',
        chunkIndex: 2,
        content: '被引用的原文内容',
        metadata: { documentId: 'doc-1', documentName: '产品说明.pdf', chunkIndex: 2 },
        score: 0.91,
      },
    ]);

    await controller.chat(
      {
        conversationId: 'conv-1',
        userId: 'user-1',
        messages: [{ id: 'ui-msg-1', role: 'user', parts: [{ type: 'text', text: '文档说了什么？' }] }],
      },
      {} as never,
    );

    const toUIMessageStreamMock = jest.requireMock('@ai-sdk/langchain').toUIMessageStream as jest.Mock;
    const streamOptions = toUIMessageStreamMock.mock.calls[0][1] as {
      onFinal: (response: string) => Promise<void>;
    };
    await streamOptions.onFinal('这是回答');

    expect(conversationService.createMessage).toHaveBeenLastCalledWith(
      'conv-1',
      MessageRole.ASSISTANT,
      '这是回答',
      [
        expect.objectContaining({
          documentId: 'doc-1',
          documentName: '产品说明.pdf',
          downloadUrl: '/api/documents/doc-1/download',
          chunkIndex: 2,
          content: '被引用的原文内容',
          score: 0.91,
          chunkId: 'chunk-1',
        }),
      ],
      4,
    );
    expect(memoryService.saveUserMemory).toHaveBeenCalledWith('user-1', 'conv-1', [
      { role: 'user', content: '文档说了什么？' },
      { role: 'assistant', content: '这是回答' },
    ]);
    expect(memoryService.saveConversationMemory).toHaveBeenCalledWith('conv-1', 'user-1', [
      { role: 'user', content: '文档说了什么？' },
      { role: 'assistant', content: '这是回答' },
    ]);
  });
});
