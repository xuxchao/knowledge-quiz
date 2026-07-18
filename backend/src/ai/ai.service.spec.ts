import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { AiService } from './ai.service';
import { LangfuseService } from '../infrastructure/langfuse/langfuse.service';

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn(),
  OpenAIEmbeddings: jest.fn(),
}));

describe('AiService', () => {
  const MockedChatOpenAI = ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>;
  const MockedOpenAIEmbeddings = OpenAIEmbeddings as jest.MockedClass<typeof OpenAIEmbeddings>;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should generate a concise conversation title', async () => {
    const chatModel = {
      invoke: jest.fn().mockResolvedValue({ content: '“知识库检索。”' }),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);

    const service = createService();
    service.onModuleInit();

    const title = await service.generateConversationTitle('怎么检索知识库里的内容？');

    expect(title).toBe('知识库检索');
    expect(chatModel.invoke).toHaveBeenCalledWith(
      [expect.objectContaining({ role: 'system' }), { role: 'user', content: '怎么检索知识库里的内容？' }],
      {
        runName: 'conversation.title',
        tags: ['chat', 'title'],
        metadata: {},
      },
    );
  });

  it('should fallback to trimmed first message when title generation fails', async () => {
    const chatModel = {
      invoke: jest.fn().mockRejectedValue(new Error('model unavailable')),
    };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);

    const service = createService();
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
    const service = createService();
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
    const service = createService();
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
    const service = createService();
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

  it('should attach one default Langfuse callback to every chat model', () => {
    const callback = { name: 'langfuse_handler' };
    const chatModel = { invoke: jest.fn() };
    MockedChatOpenAI.mockImplementation(() => chatModel as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);
    const langfuseService = createLangfuseService();
    langfuseService.getLangChainCallbacks.mockReturnValue([callback] as never);

    const service = new AiService(createConfigService(), langfuseService);
    service.onModuleInit();

    expect(MockedChatOpenAI).toHaveBeenCalledTimes(4);
    for (const [options] of MockedChatOpenAI.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ callbacks: [callback] }));
    }
  });

  it('should trace embeddings with dimensions instead of vector values', async () => {
    const embeddings = { embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    MockedChatOpenAI.mockImplementation(() => ({}) as never);
    MockedOpenAIEmbeddings.mockImplementation(() => embeddings as never);
    const langfuseService = createLangfuseService();
    const service = new AiService(createConfigService(), langfuseService);
    service.onModuleInit();

    await expect(service.generateEmbedding('正文')).resolves.toEqual([0.1, 0.2, 0.3]);

    expect(langfuseService.observeEmbedding).toHaveBeenCalledWith(
      'embedding.query',
      expect.objectContaining({
        attributes: expect.objectContaining({ input: '正文', model: 'text-embedding-v2' }),
        summarizeOutput: expect.any(Function),
      }),
      expect.any(Function),
    );
    const options = langfuseService.observeEmbedding.mock.calls[0][1] as {
      summarizeOutput: (embedding: number[]) => unknown;
    };
    expect(options.summarizeOutput([0.1, 0.2, 0.3])).toEqual({ count: 1, dimensions: 3 });
  });

  it('should trace DashScope reranking and return normalized scores', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        output: { results: [{ index: 1, relevance_score: 0.93 }] },
      }),
    } as never);
    MockedChatOpenAI.mockImplementation(() => ({}) as never);
    MockedOpenAIEmbeddings.mockImplementation(() => ({}) as never);
    const langfuseService = createLangfuseService();
    const service = new AiService(createConfigService(), langfuseService);
    service.onModuleInit();

    await expect(service.rerank('问题', ['文档一', '文档二'])).resolves.toEqual([{ index: 1, score: 0.93 }]);
    expect(langfuseService.observeGeneration).toHaveBeenCalledWith(
      'rag.rerank',
      expect.objectContaining({
        attributes: expect.objectContaining({
          input: { query: '问题', documents: ['文档一', '文档二'] },
          model: 'gte-rerank-v2',
        }),
      }),
      expect.any(Function),
    );
  });
});

const createService = (): AiService => {
  const service = new AiService(createConfigService(), createLangfuseService());
  service.onModuleInit();
  return service;
};

const createLangfuseService = () =>
  ({
    getLangChainCallbacks: jest.fn().mockReturnValue([]),
    buildLangChainMetadata: jest.fn((context) =>
      context
        ? {
            langfuseSessionId: context.conversationId,
            langfuseUserId: context.userId,
            conversationId: context.conversationId,
          }
        : {},
    ),
    observeGeneration: jest.fn((_name, _options, operation) => operation()),
    observeEmbedding: jest.fn((_name, _options, operation) => operation()),
  }) as unknown as jest.Mocked<LangfuseService>;

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
