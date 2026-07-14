import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { LoggerService, LogServiceCall } from '../common/logger';

export interface ConversationPromptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new LoggerService(AiService.name);
  private chatModel: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;
  private visionModel: ChatOpenAI;
  private summaryModel: ChatOpenAI;

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
      maxTokens: Number(this.configService.get<string>('AI_MAX_OUTPUT_TOKENS', '4096')),
      streaming: true,
    });

    this.embeddings = new OpenAIEmbeddings({
      apiKey,
      configuration: {
        baseURL: apiBaseUrl,
      },
      model: 'text-embedding-v2',
    });

    this.visionModel = new ChatOpenAI({
      apiKey,
      configuration: { baseURL: apiBaseUrl },
      model: this.configService.get<string>('QWEN_VISION_MODEL', 'qwen-vl-plus'),
      temperature: 0.1,
      maxTokens: 2048,
    });

    this.summaryModel = new ChatOpenAI({
      apiKey,
      configuration: { baseURL: apiBaseUrl },
      model: 'qwen-plus',
      temperature: 0.1,
      maxTokens: Number(this.configService.get<string>('AI_SUMMARY_MAX_TOKENS', '2048')),
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
  async describeImage(dataUrl: string): Promise<string> {
    const response = await this.visionModel.invoke([
      {
        role: 'user',
        content: [
          { type: 'text', text: '提取图片中的全部可读文字，并准确描述图表、对象和关键关系。不要猜测不可见内容。' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]);
    return this.extractMessageContent(response).trim();
  }

  @LogServiceCall()
  async streamConversation(
    messages: ConversationPromptMessage[],
    systemPrompt: string,
    callbacks: BaseCallbackHandler[] = [],
  ): Promise<AsyncIterable<AIMessageChunk>> {
    const langChainMessages = messages.map((message) => {
      const role = message.role === 'user' ? 'human' : message.role === 'assistant' ? 'ai' : 'system';
      return [role, message.content] as ['human' | 'ai' | 'system', string];
    });
    return this.chatModel.stream([['system', systemPrompt], ...langChainMessages], {
      callbacks,
      runName: 'conversation.chat',
      tags: ['chat'],
    });
  }

  @LogServiceCall()
  async generateConversationSummary(
    previousSummary: string | null,
    messages: ConversationPromptMessage[],
    callbacks: BaseCallbackHandler[] = [],
  ): Promise<string> {
    const response = await this.summaryModel.invoke(
      [
        {
          role: 'system',
          content:
            '你是会话压缩助手。将已有摘要和新增对话合并成独立可读的中文摘要。必须保留用户目标、事实、约束、决定、重要实体、未解决问题和必要引用；删除寒暄、重复及无关细节。不要编造信息。只输出摘要正文。',
        },
        {
          role: 'user',
          content: `已有摘要：\n${previousSummary || '无'}\n\n新增对话：\n${messages
            .map((item) => `${item.role}: ${item.content}`)
            .join('\n')}`,
        },
      ],
      {
        callbacks,
        runName: 'conversation.summary',
        tags: ['chat', 'summary'],
      },
    );
    const summary = this.extractMessageContent(response).trim();
    if (!summary) throw new Error('摘要模型返回空内容');
    return summary;
  }

  @LogServiceCall()
  async generateConversationTitle(firstMessage: string, callbacks: BaseCallbackHandler[] = []): Promise<string> {
    const fallbackTitle = this.buildFallbackTitle(firstMessage);

    try {
      const response = await this.chatModel.invoke(
        [
          {
            role: 'system',
            content:
              '你是会话标题生成助手。请根据用户第一句话生成一个简短中文标题，最多12个汉字，不要使用引号、句号或解释。',
          },
          {
            role: 'user',
            content: firstMessage,
          },
        ],
        {
          callbacks,
          runName: 'conversation.title',
          tags: ['chat', 'title'],
        },
      );

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
