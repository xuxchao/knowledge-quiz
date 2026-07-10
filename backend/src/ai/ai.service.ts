import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import { LoggerService, LogServiceCall } from '../common/logger';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new LoggerService(AiService.name);
  private chatModel: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('QWEN_API_KEY');
    const apiBaseUrl = this.configService.get<string>(
      'QWEN_API_BASE_URL',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );

    if (!apiKey) {
      throw new Error('QWEN_API_KEY environment variable is not set');
    }

    this.chatModel = new ChatOpenAI({
      apiKey,
      configuration: {
        baseURL: apiBaseUrl,
      },
      model: 'qwen-plus',
      temperature: 0.7,
      maxTokens: 4096,
      streaming: true,
    });

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      configuration: {
        baseURL: apiBaseUrl,
      },
      model: 'text-embedding-v2',
    });

    this.logger.info('AI服务初始化完成');
  }

  getChatModel(): ChatOpenAI {
    return this.chatModel;
  }

  getEmbeddings(): OpenAIEmbeddings {
    return this.embeddings;
  }

  @LogServiceCall()
  async generateEmbedding(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  @LogServiceCall()
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }

  @LogServiceCall()
  async streamChain(query: string, systemPrompt: string): Promise<AsyncIterable<AIMessageChunk>> {
    return this.chatModel.stream([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ]);
  }

  @LogServiceCall()
  async generateConversationTitle(firstMessage: string): Promise<string> {
    const fallbackTitle = this.buildFallbackTitle(firstMessage);

    try {
      const response = await this.chatModel.invoke([
        {
          role: 'system',
          content:
            '你是会话标题生成助手。请根据用户第一句话生成一个简短中文标题，最多12个汉字，不要使用引号、句号或解释。',
        },
        {
          role: 'user',
          content: firstMessage,
        },
      ]);

      const title = this.extractMessageContent(response)
        .replace(/["'“”‘’。.!！?？]/g, '')
        .trim();
      return title.slice(0, 24) || fallbackTitle;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.logger.error(`会话标题生成失败，使用兜底标题，错误: ${errorMessage}`, stackTrace);
      return fallbackTitle;
    }
  }

  private extractMessageContent(message: BaseMessage): string {
    const { content } = message;
    if (typeof content === 'string') {
      return content;
    }

    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if ('text' in item && typeof item.text === 'string') {
          return item.text;
        }

        return '';
      })
      .join('');
  }

  private buildFallbackTitle(message: string): string {
    const normalized = message.replace(/\s+/g, ' ').trim();
    return normalized.slice(0, 24) || '新的会话';
  }
}
