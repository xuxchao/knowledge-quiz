import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { AiService } from './ai.service';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn(),
  OpenAIEmbeddings: jest.fn(),
}));

describe('AiService', () => {
  const MockedChatOpenAI = ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>;
  const MockedOpenAIEmbeddings = OpenAIEmbeddings as jest.MockedClass<typeof OpenAIEmbeddings>;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a concise conversation title', async () => {
    const chatModel = {
      invoke: jest.fn().mockResolvedValue({ content: '“知识库检索。”' }),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);

    const service = new AiService(createConfigService());
    service.onModuleInit();

    const title = await service.generateConversationTitle('怎么检索知识库里的内容？');

    expect(title).toBe('知识库检索');
    expect(chatModel.invoke).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: '怎么检索知识库里的内容？' },
    ]);
  });

  it('should fallback to trimmed first message when title generation fails', async () => {
    const chatModel = {
      invoke: jest.fn().mockRejectedValue(new Error('model unavailable')),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);

    const service = new AiService(createConfigService());
    service.onModuleInit();

    const title = await service.generateConversationTitle('  这是一个很长的用户问题，需要被截断成标题使用  ');

    expect(title).toBe('这是一个很长的用户问题，需要被截断成标题使用');
  });
});

const createConfigService = (): ConfigService =>
  ({
    get: jest.fn((key: string, defaultValue?: string) => {
      const values: Record<string, string> = {
        QWEN_API_KEY: 'test-key',
        QWEN_API_BASE_URL: 'https://example.com/v1',
      };
      return values[key] ?? defaultValue;
    }),
  }) as unknown as ConfigService;
