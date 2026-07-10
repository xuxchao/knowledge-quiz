import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LangfuseOptions } from 'langfuse';
import { LoggerService, LogServiceCall } from '../../common/logger';

type LangfuseTraceLike = {
  generation: (body: Record<string, unknown>) => LangfuseGenerationLike;
  update?: (body: Record<string, unknown>) => void;
};

type LangfuseGenerationLike = {
  update?: (body: Record<string, unknown>) => void;
  end?: (body?: Record<string, unknown>) => void;
};

type LangfuseClientLike = {
  trace: (body: Record<string, unknown>) => LangfuseTraceLike;
  flushAsync: () => Promise<void>;
  shutdownAsync: () => Promise<void>;
};

type ChatTraceInput = {
  conversationId: string;
  userId: string;
  message: string;
  systemPrompt: string;
};

@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(LangfuseService.name);
  private client?: LangfuseClientLike;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const publicKey = this.configService.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.configService.get<string>('LANGFUSE_SECRET_KEY');
    const baseUrl =
      this.configService.get<string>('LANGFUSE_HOST') ?? this.configService.get<string>('LANGFUSE_BASE_URL');

    if (!publicKey || !secretKey || !baseUrl) {
      this.logger.warn('Langfuse配置不完整，已跳过上报初始化');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Langfuse v3 loads dynamic imports that break Jest when imported at module scope.
    const { Langfuse } = require('langfuse') as {
      Langfuse: new (params: { publicKey?: string; secretKey?: string } & LangfuseOptions) => LangfuseClientLike;
    };

    this.client = new Langfuse({
      publicKey,
      secretKey,
      baseUrl,
      enabled: true,
    });
    this.logger.info('Langfuse上报初始化完成');
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  isEnabled(): boolean {
    return Boolean(this.client);
  }

  @LogServiceCall()
  startChatTrace(input: ChatTraceInput): LangfuseTraceLike | undefined {
    if (!this.client) return undefined;

    try {
      return this.client.trace({
        name: 'conversation.chat',
        sessionId: input.conversationId,
        userId: input.userId,
        input: input.message,
        metadata: {
          conversationId: input.conversationId,
          systemPromptLength: input.systemPrompt.length,
        },
        tags: ['chat'],
      });
    } catch (error: unknown) {
      this.logLangfuseError('创建Langfuse trace失败', error);
      return undefined;
    }
  }

  @LogServiceCall()
  startGeneration(
    trace: LangfuseTraceLike | undefined,
    model: string,
    input: string,
  ): LangfuseGenerationLike | undefined {
    try {
      return trace?.generation({
        name: 'qwen.chat.stream',
        model,
        input,
        startTime: new Date(),
      });
    } catch (error: unknown) {
      this.logLangfuseError('创建Langfuse generation失败', error);
      return undefined;
    }
  }

  @LogServiceCall()
  completeGeneration(
    trace: LangfuseTraceLike | undefined,
    generation: LangfuseGenerationLike | undefined,
    output: string,
  ): void {
    try {
      generation?.end?.({
        output,
        endTime: new Date(),
        level: 'DEFAULT',
      });
      trace?.update?.({
        output,
      });
    } catch (error: unknown) {
      this.logLangfuseError('完成Langfuse generation失败', error);
    }
  }

  @LogServiceCall()
  failGeneration(
    generation: LangfuseGenerationLike | undefined,
    errorMessage: string,
    trace?: LangfuseTraceLike,
  ): void {
    try {
      generation?.end?.({
        endTime: new Date(),
        level: 'ERROR',
        statusMessage: errorMessage,
      });
      trace?.update?.({
        metadata: {
          error: errorMessage,
        },
      });
    } catch (error: unknown) {
      this.logLangfuseError('记录Langfuse异常状态失败', error);
    }
  }

  @LogServiceCall()
  async flush(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.flushAsync();
    } catch (error: unknown) {
      this.logLangfuseError('刷新Langfuse事件失败', error);
    }
  }

  @LogServiceCall()
  async shutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.shutdownAsync();
    } catch (error: unknown) {
      this.logLangfuseError('关闭Langfuse客户端失败', error);
    }
  }

  private logLangfuseError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;
    this.logger.error(`${message}，错误: ${errorMessage}`, stackTrace);
  }
}
