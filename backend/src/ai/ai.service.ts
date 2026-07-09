import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import type { AIMessageChunk } from '@langchain/core/messages';
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
}
