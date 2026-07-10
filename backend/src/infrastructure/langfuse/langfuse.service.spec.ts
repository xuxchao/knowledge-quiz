import { ConfigService } from '@nestjs/config';
import { LangfuseService } from './langfuse.service';

jest.mock('langfuse', () => ({
  Langfuse: jest.fn(),
}));

describe('LangfuseService', () => {
  const MockedLangfuse: jest.Mock = jest.requireMock('langfuse').Langfuse;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should skip initialization when required config is missing', () => {
    const service = new LangfuseService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    service.onModuleInit();

    expect(service.isEnabled()).toBe(false);
    expect(MockedLangfuse).not.toHaveBeenCalled();
  });

  it('should initialize client and create chat generation traces', async () => {
    const generation = {
      end: jest.fn(),
    };
    const trace = {
      generation: jest.fn().mockReturnValue(generation),
      update: jest.fn(),
    };
    const client = {
      trace: jest.fn().mockReturnValue(trace),
      flushAsync: jest.fn().mockResolvedValue(undefined),
      shutdownAsync: jest.fn().mockResolvedValue(undefined),
    };

    MockedLangfuse.mockImplementation(() => client as never);

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
    const startedTrace = service.startChatTrace({
      conversationId: 'conv-1',
      userId: 'user-1',
      message: '你好',
      systemPrompt: '系统提示词',
    });
    const startedGeneration = service.startGeneration(startedTrace, 'qwen-plus', '你好');
    service.completeGeneration(startedTrace, startedGeneration, '你好，有什么可以帮你？');
    await service.flush();
    await service.shutdown();

    expect(MockedLangfuse).toHaveBeenCalledWith({
      publicKey: 'public-key',
      secretKey: 'secret-key',
      baseUrl: 'http://localhost:3005',
      enabled: true,
    });
    expect(client.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversation.chat',
        sessionId: 'conv-1',
        userId: 'user-1',
        input: '你好',
      }),
    );
    expect(trace.generation).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'qwen.chat.stream',
        model: 'qwen-plus',
        input: '你好',
      }),
    );
    expect(generation.end).toHaveBeenCalledWith(
      expect.objectContaining({
        output: '你好，有什么可以帮你？',
        level: 'DEFAULT',
      }),
    );
    expect(trace.update).toHaveBeenCalledWith({ output: '你好，有什么可以帮你？' });
    expect(client.flushAsync).toHaveBeenCalled();
    expect(client.shutdownAsync).toHaveBeenCalled();
  });
});
