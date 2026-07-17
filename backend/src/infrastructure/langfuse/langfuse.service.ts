import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackHandler } from '@langfuse/langchain';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startActiveObservation, type LangfuseGenerationAttributes } from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { LoggerService, LogServiceCall } from '../../common/logger';

export interface ChatTraceContext {
  conversationId: string;
  userId: string;
}

export interface LangfuseObservationOptions<T> {
  attributes: LangfuseGenerationAttributes;
  context?: ChatTraceContext;
  summarizeOutput?: (result: T) => unknown;
}

export interface LangfuseEmbeddingOptions<T> {
  attributes: LangfuseGenerationAttributes;
  context?: ChatTraceContext;
  summarizeOutput: (result: T) => unknown;
}

@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(LangfuseService.name);
  private sdk?: NodeSDK;
  private spanProcessor?: LangfuseSpanProcessor;
  private client?: LangfuseClient;
  private callbackHandler?: CallbackHandler;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const publicKey = this.configService.get<string>('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.configService.get<string>('LANGFUSE_SECRET_KEY');
    const baseUrl =
      this.configService.get<string>('LANGFUSE_BASE_URL') ?? this.configService.get<string>('LANGFUSE_HOST');

    if (!publicKey || !secretKey || !baseUrl) {
      this.logger.warn('Langfuse配置不完整，已跳过LangChain自动上报初始化');
      return;
    }

    this.spanProcessor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      exportMode: 'batched',
      mediaUploadEnabled: false,
      mask: ({ data }) => this.maskMediaPayloads(data),
    });
    this.sdk = new NodeSDK({ spanProcessors: [this.spanProcessor] });
    this.sdk.start();
    this.client = new LangfuseClient({ publicKey, secretKey, baseUrl });
    this.callbackHandler = new CallbackHandler({ tags: ['langchain'] });
    this.logger.info('Langfuse LangChain自动上报初始化完成');
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  isEnabled(): boolean {
    return Boolean(this.sdk);
  }

  @LogServiceCall()
  getLangChainCallbacks(): BaseCallbackHandler[] {
    return this.callbackHandler ? [this.callbackHandler] : [];
  }

  @LogServiceCall()
  buildLangChainMetadata(context?: ChatTraceContext): Record<string, unknown> {
    if (!context) return {};
    return {
      langfuseSessionId: context.conversationId,
      langfuseUserId: context.userId,
      conversationId: context.conversationId,
    };
  }

  @LogServiceCall()
  observeGeneration<T>(name: string, options: LangfuseObservationOptions<T>, operation: () => Promise<T>): Promise<T> {
    if (!this.sdk) return operation();
    return this.observeSafely(
      name,
      'generation',
      options,
      operation,
      (result) => options.summarizeOutput?.(result) ?? result,
    );
  }

  @LogServiceCall()
  observeEmbedding<T>(name: string, options: LangfuseEmbeddingOptions<T>, operation: () => Promise<T>): Promise<T> {
    if (!this.sdk) return operation();
    return this.observeSafely(name, 'embedding', options, operation, options.summarizeOutput);
  }

  @LogServiceCall()
  async flush(): Promise<void> {
    try {
      await Promise.all([this.spanProcessor?.forceFlush(), this.client?.flush()]);
    } catch (error: unknown) {
      this.logLangfuseError('刷新Langfuse事件失败', error);
    }
  }

  @LogServiceCall()
  async shutdown(): Promise<void> {
    try {
      await Promise.all([this.sdk?.shutdown(), this.client?.shutdown()]);
      this.sdk = undefined;
      this.spanProcessor = undefined;
      this.client = undefined;
      this.callbackHandler = undefined;
    } catch (error: unknown) {
      this.logLangfuseError('关闭Langfuse客户端失败', error);
    }
  }

  @LogServiceCall()
  async scoreSession(
    sessionId: string,
    name: string,
    value: number,
    metadata: Record<string, string | number | boolean> = {},
  ): Promise<void> {
    if (!this.client) return;

    try {
      this.client.score.create({
        sessionId,
        name,
        value: Math.max(0, Math.min(1, value)),
        dataType: 'NUMERIC',
        metadata,
      });
      await this.client.flush();
    } catch (error: unknown) {
      this.logLangfuseError('写入Langfuse评分失败', error);
    }
  }

  private logLangfuseError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;
    this.logger.error(`${message}，错误: ${errorMessage}`, stackTrace);
  }

  private withTraceContext<T>(context: ChatTraceContext | undefined, operation: () => T): T {
    if (!context) return operation();
    return propagateAttributes(
      {
        sessionId: context.conversationId,
        userId: context.userId,
        metadata: { conversationId: context.conversationId },
      },
      operation,
    );
  }

  private async observeSafely<T>(
    name: string,
    asType: 'generation' | 'embedding',
    options: LangfuseObservationOptions<T>,
    operation: () => Promise<T>,
    summarizeOutput: (result: T) => unknown,
  ): Promise<T> {
    let operationStarted = false;
    let operationCompleted = false;
    let operationFailed = false;
    let result: T;
    let operationError: unknown;

    try {
      await this.withTraceContext(options.context, () =>
        startActiveObservation(
          name,
          async (observation) => {
            observation.update(options.attributes);
            operationStarted = true;
            try {
              result = await operation();
              operationCompleted = true;
            } catch (error: unknown) {
              operationFailed = true;
              operationError = error;
              throw error;
            }
            observation.update({ output: summarizeOutput(result) });
            return result;
          },
          { asType },
        ),
      );
    } catch (error: unknown) {
      if (operationFailed) throw operationError;
      this.logLangfuseError(`Langfuse观测失败，业务调用继续执行 - ${name}`, error);
      if (!operationStarted) return operation();
    }

    if (operationCompleted) return result!;
    this.logger.warn(`Langfuse观测未执行业务回调，业务调用继续执行 - ${name}`);
    return operation();
  }

  private maskMediaPayloads(data: unknown): unknown {
    if (typeof data === 'string') {
      return data.replace(/data:([^;,]+);base64,([A-Za-z0-9+/=]+)/g, (_match, mimeType: string, payload: string) => {
        return `[媒体内容已脱敏 mime=${mimeType} base64Chars=${payload.length}]`;
      });
    }
    if (Array.isArray(data)) return data.map((item) => this.maskMediaPayloads(item));
    if (data && typeof data === 'object') {
      return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, this.maskMediaPayloads(value)]));
    }
    return data;
  }
}
