import { ConfigService } from '@nestjs/config';
import { LangfuseService } from './langfuse.service';

jest.mock('@langfuse/langchain', () => ({
  CallbackHandler: jest.fn().mockImplementation((params) => ({ params })),
}));

jest.mock('@langfuse/client', () => ({
  LangfuseClient: jest.fn().mockImplementation(() => ({
    score: { create: jest.fn() },
    flush: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: jest.fn().mockImplementation(() => ({
    forceFlush: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@langfuse/tracing', () => ({
  propagateAttributes: jest.fn((_params, operation) => operation()),
  startActiveObservation: jest.fn(),
}));

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('LangfuseService', () => {
  const MockedCallbackHandler = jest.requireMock('@langfuse/langchain').CallbackHandler as jest.Mock;
  const MockedSpanProcessor = jest.requireMock('@langfuse/otel').LangfuseSpanProcessor as jest.Mock;
  const MockedNodeSDK = jest.requireMock('@opentelemetry/sdk-node').NodeSDK as jest.Mock;
  const MockedLangfuseClient = jest.requireMock('@langfuse/client').LangfuseClient as jest.Mock;
  const MockedStartActiveObservation = jest.requireMock('@langfuse/tracing').startActiveObservation as jest.Mock;
  const observation = { update: jest.fn() };

  beforeEach(() => {
    MockedStartActiveObservation.mockImplementation((_name, operation) => operation(observation));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should skip initialization when required config is missing', () => {
    const service = new LangfuseService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    service.onModuleInit();

    expect(service.isEnabled()).toBe(false);
    expect(MockedSpanProcessor).not.toHaveBeenCalled();
  });

  it('should initialize OTEL and reuse one LangChain callback', async () => {
    const service = new LangfuseService({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          LANGFUSE_PUBLIC_KEY: 'public-key',
          LANGFUSE_SECRET_KEY: 'secret-key',
          LANGFUSE_HOST: 'http://localhost:3005',
        };
        return values[key];
      }),
    } as unknown as ConfigService);

    service.onModuleInit();
    const firstCallbacks = service.getLangChainCallbacks();
    const secondCallbacks = service.getLangChainCallbacks();
    await service.scoreSession('conv-1', 'groundedness', 1.2, { citationCount: 2 });
    await service.flush();
    await service.shutdown();

    expect(MockedSpanProcessor).toHaveBeenCalledWith({
      publicKey: 'public-key',
      secretKey: 'secret-key',
      baseUrl: 'http://localhost:3005',
      exportMode: 'batched',
      mediaUploadEnabled: false,
      mask: expect.any(Function),
    });
    expect(MockedNodeSDK).toHaveBeenCalledWith({ spanProcessors: [expect.any(Object)] });
    expect(MockedLangfuseClient).toHaveBeenCalledWith({
      publicKey: 'public-key',
      secretKey: 'secret-key',
      baseUrl: 'http://localhost:3005',
    });
    expect(MockedCallbackHandler).toHaveBeenCalledTimes(1);
    expect(MockedCallbackHandler).toHaveBeenCalledWith({ tags: ['langchain'] });
    expect(firstCallbacks).toEqual(secondCallbacks);
    expect(firstCallbacks).toHaveLength(1);

    const spanProcessor = MockedSpanProcessor.mock.results[0].value as { forceFlush: jest.Mock };
    const sdk = MockedNodeSDK.mock.results[0].value as { start: jest.Mock; shutdown: jest.Mock };
    const client = MockedLangfuseClient.mock.results[0].value as {
      score: { create: jest.Mock };
      flush: jest.Mock;
      shutdown: jest.Mock;
    };
    expect(sdk.start).toHaveBeenCalled();
    expect(spanProcessor.forceFlush).toHaveBeenCalled();
    expect(sdk.shutdown).toHaveBeenCalled();
    expect(client.score.create).toHaveBeenCalledWith({
      sessionId: 'conv-1',
      name: 'groundedness',
      value: 1,
      dataType: 'NUMERIC',
      metadata: { citationCount: 2 },
    });
    expect(client.flush).toHaveBeenCalled();
    expect(client.shutdown).toHaveBeenCalled();
  });

  it('should trace generations and embeddings without exposing vector output', async () => {
    const service = createEnabledService();
    service.onModuleInit();

    await expect(
      service.observeGeneration(
        'rag.rerank',
        {
          attributes: { input: { query: '问题', documents: ['正文'] }, model: 'gte-rerank-v2' },
          summarizeOutput: (result: number[]) => ({ count: result.length }),
        },
        async () => [0.9],
      ),
    ).resolves.toEqual([0.9]);
    await expect(
      service.observeEmbedding(
        'embedding.query',
        {
          attributes: { input: '正文', model: 'text-embedding-v2' },
          summarizeOutput: (result: number[]) => ({ dimensions: result.length }),
        },
        async () => [0.1, 0.2],
      ),
    ).resolves.toEqual([0.1, 0.2]);

    expect(MockedStartActiveObservation).toHaveBeenCalledWith('rag.rerank', expect.any(Function), {
      asType: 'generation',
    });
    expect(MockedStartActiveObservation).toHaveBeenCalledWith('embedding.query', expect.any(Function), {
      asType: 'embedding',
    });
    expect(observation.update).toHaveBeenCalledWith({ output: { dimensions: 2 } });
    expect(observation.update).not.toHaveBeenCalledWith(expect.objectContaining({ output: [0.1, 0.2] }));
  });

  it('should redact base64 media in the processor mask', () => {
    const service = createEnabledService();
    service.onModuleInit();
    const processorOptions = MockedSpanProcessor.mock.calls[0][0] as {
      mask: (params: { data: unknown }) => unknown;
    };

    expect(
      processorOptions.mask({ data: { url: 'data:image/png;base64,QUJDRA==' } }),
    ).toEqual({ url: '[媒体内容已脱敏 mime=image/png base64Chars=8]' });
  });

  it('should execute the operation once when tracing fails before the operation starts', async () => {
    const service = createEnabledService();
    service.onModuleInit();
    const operation = jest.fn().mockResolvedValue('result');
    MockedStartActiveObservation.mockRejectedValueOnce(new Error('tracing unavailable'));

    await expect(
      service.observeGeneration('test.generation', { attributes: { input: 'input' } }, operation),
    ).resolves.toBe('result');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should preserve the result when tracing fails after the operation completes', async () => {
    const service = createEnabledService();
    service.onModuleInit();
    const operation = jest.fn().mockResolvedValue('result');
    observation.update.mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      throw new Error('export failed');
    });

    await expect(
      service.observeGeneration('test.generation', { attributes: { input: 'input' } }, operation),
    ).resolves.toBe('result');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should preserve operation errors without retrying the operation', async () => {
    const service = createEnabledService();
    service.onModuleInit();
    const operationError = new Error('provider failed');
    const operation = jest.fn().mockRejectedValue(operationError);

    await expect(
      service.observeGeneration('test.generation', { attributes: { input: 'input' } }, operation),
    ).rejects.toBe(operationError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  function createEnabledService(): LangfuseService {
    return new LangfuseService({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          LANGFUSE_PUBLIC_KEY: 'public-key',
          LANGFUSE_SECRET_KEY: 'secret-key',
          LANGFUSE_HOST: 'http://localhost:3005',
        };
        return values[key];
      }),
    } as unknown as ConfigService);
  }
});
