import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ConversationService } from '../conversations/conversation.service';
import { AiService } from './ai.service';
import { MemoryService } from '../memory/memory.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { LangfuseService } from '../infrastructure/langfuse/langfuse.service';
import { MessageRole } from '../entities/message.entity';

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
  let neo4jService: jest.Mocked<Neo4jService>;
  let langfuseService: jest.Mocked<LangfuseService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ConversationService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'conv-1', title: '知识库检索' }),
            createMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
          },
        },
        {
          provide: AiService,
          useValue: {
            generateConversationTitle: jest.fn().mockResolvedValue('知识库检索'),
            generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
            streamChain: jest.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () {},
            }),
          },
        },
        {
          provide: MemoryService,
          useValue: {
            saveShortTermMemory: jest.fn().mockResolvedValue(undefined),
            getRelevantMemories: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: Neo4jService,
          useValue: {
            search: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: LangfuseService,
          useValue: {
            startChatTrace: jest.fn().mockReturnValue({ trace: true }),
            startGeneration: jest.fn().mockReturnValue({ generation: true }),
            completeGeneration: jest.fn(),
            failGeneration: jest.fn(),
            flush: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get(ChatController);
    conversationService = module.get(ConversationService);
    aiService = module.get(AiService);
    memoryService = module.get(MemoryService);
    neo4jService = module.get(Neo4jService);
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

    expect(aiService.generateConversationTitle).toHaveBeenCalledWith('怎么检索知识库里的内容？');
    expect(conversationService.create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: '知识库检索',
    });
    expect(conversationService.createMessage).toHaveBeenCalledWith(
      'conv-1',
      MessageRole.USER,
      '怎么检索知识库里的内容？',
    );
  });

  it('should report chat trace to langfuse when streaming starts', async () => {
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
    expect(langfuseService.startChatTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        userId: 'user-1',
        message: '继续讲一下',
      }),
    );
    expect(langfuseService.startGeneration).toHaveBeenCalledWith({ trace: true }, 'qwen-plus', '继续讲一下');
    expect(memoryService.saveShortTermMemory).toHaveBeenCalledWith('conv-1', '继续讲一下');
    expect(neo4jService.search).toHaveBeenCalledWith([0.1, 0.2], 5);
  });
});
