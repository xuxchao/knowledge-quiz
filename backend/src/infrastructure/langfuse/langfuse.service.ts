import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackHandler } from '@langfuse/langchain';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LoggerService, LogServiceCall } from '../../common/logger';

export interface ChatTraceContext {
  conversationId: string;
  userId: string;
}

@Injectable()
export class LangfuseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(LangfuseService.name);
  private sdk?: NodeSDK;
  private spanProcessor?: LangfuseSpanProcessor;
  private client?: LangfuseClient;

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
    });
    this.sdk = new NodeSDK({ spanProcessors: [this.spanProcessor] });
    this.sdk.start();
    this.client = new LangfuseClient({ publicKey, secretKey, baseUrl });
    this.logger.info('Langfuse LangChain自动上报初始化完成');
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  isEnabled(): boolean {
    return Boolean(this.sdk);
  }

  @LogServiceCall()
  createChatHandler(context: ChatTraceContext): CallbackHandler | undefined {
    if (!this.sdk) return undefined;

    return new CallbackHandler({
      sessionId: context.conversationId,
      userId: context.userId,
      tags: ['chat', 'langchain'],
      traceMetadata: {
        conversationId: context.conversationId,
      },
    });
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
}
