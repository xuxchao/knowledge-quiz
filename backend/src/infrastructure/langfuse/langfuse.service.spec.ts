import { ConfigService } from '@nestjs/config';
import { LangfuseService } from './langfuse.service';

jest.mock('@langfuse/langchain', () => ({
  CallbackHandler: jest.fn().mockImplementation((params) => ({ params })),
}));

jest.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: jest.fn().mockImplementation(() => ({
    forceFlush: jest.fn().mockResolvedValue(undefined),
  })),
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

  it('should initialize OTEL and create a session-aware LangChain callback', async () => {
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
    const handler = service.createChatHandler({ conversationId: 'conv-1', userId: 'user-1' });
    await service.flush();
    await service.shutdown();

    expect(MockedSpanProcessor).toHaveBeenCalledWith({
      publicKey: 'public-key',
      secretKey: 'secret-key',
      baseUrl: 'http://localhost:3005',
      exportMode: 'batched',
      mediaUploadEnabled: false,
    });
    expect(MockedNodeSDK).toHaveBeenCalledWith({ spanProcessors: [expect.any(Object)] });
    expect(MockedCallbackHandler).toHaveBeenCalledWith({
      sessionId: 'conv-1',
      userId: 'user-1',
      tags: ['chat', 'langchain'],
      traceMetadata: { conversationId: 'conv-1' },
    });
    expect(handler).toEqual({
      params: expect.objectContaining({ sessionId: 'conv-1', userId: 'user-1' }),
    });

    const spanProcessor = MockedSpanProcessor.mock.results[0].value as { forceFlush: jest.Mock };
    const sdk = MockedNodeSDK.mock.results[0].value as { start: jest.Mock; shutdown: jest.Mock };
    expect(sdk.start).toHaveBeenCalled();
    expect(spanProcessor.forceFlush).toHaveBeenCalled();
    expect(sdk.shutdown).toHaveBeenCalled();
  });
});
