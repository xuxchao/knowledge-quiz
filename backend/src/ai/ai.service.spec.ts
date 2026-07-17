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
    expect(chatModel.invoke).toHaveBeenCalledWith(
      [expect.objectContaining({ role: 'system' }), { role: 'user', content: '怎么检索知识库里的内容？' }],
      {
        callbacks: [],
        runName: 'conversation.title',
        tags: ['chat', 'title'],
      },
    );
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

  it('should parse structured output with JsonOutputParser and JSON response mode', async () => {
    const chatModel = {
      invoke: jest.fn().mockResolvedValue({ content: '```json\n{"entities":[],"relations":[]}\n```' }),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);
    const service = new AiService(createConfigService());
    service.onModuleInit();

    const result = await service.generateStructuredJson<{ entities: unknown[]; relations: unknown[] }>(
      '抽取实体关系。',
      '正文',
      'novel-graph.test',
    );

    expect(result).toEqual({ entities: [], relations: [] });
    expect(chatModel.invoke).toHaveBeenCalledWith(
      [expect.objectContaining({ role: 'system' }), { role: 'user', content: '正文' }],
      expect.objectContaining({ response_format: { type: 'json_object' } }),
    );
  });

  it('should retry malformed structured output and request a complete JSON object', async () => {
    const chatModel = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ content: '{"entities":[' })
        .mockResolvedValueOnce({ content: '{"entities":[],"relations":[]}' }),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);
    const service = new AiService(createConfigService());
    service.onModuleInit();

    await expect(
      service.generateStructuredJson<{ entities: unknown[]; relations: unknown[] }>(
        '抽取实体关系。',
        '正文',
        'novel-graph.test',
      ),
    ).resolves.toEqual({ entities: [], relations: [] });
    expect(chatModel.invoke).toHaveBeenCalledTimes(2);
    expect(chatModel.invoke.mock.calls[1][0][0]).toEqual(
      expect.objectContaining({ content: expect.stringContaining('绝对不要截断JSON') }),
    );
  });

  it('should reject a JSON array and retry until the model returns an object', async () => {
    const chatModel = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({ content: '[]' })
        .mockResolvedValueOnce({ content: '{"entities":[],"relations":[]}' }),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);
    const service = new AiService(createConfigService());
    service.onModuleInit();

    await expect(
      service.generateStructuredJson<{ entities: unknown[]; relations: unknown[] }>(
        '抽取实体关系。',
        '正文',
        'novel-graph.test',
      ),
    ).resolves.toEqual({ entities: [], relations: [] });
    expect(chatModel.invoke).toHaveBeenCalledTimes(2);
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
