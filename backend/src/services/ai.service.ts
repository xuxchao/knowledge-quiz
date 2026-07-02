import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class AiService implements OnModuleInit {
  private chatModel: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const apiKey = this.configService.get<string>('QWEN_API_KEY');
    const apiBaseUrl = this.configService.get<string>('QWEN_API_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');

    this.chatModel = new ChatOpenAI({
      apiKey: apiKey || '',
      configuration: {
        baseURL: apiBaseUrl,
      },
      model: 'qwen-max',
      temperature: 0.7,
      maxTokens: 4096,
      streaming: true,
    });

    this.embeddings = new OpenAIEmbeddings({
      apiKey: apiKey || '',
      configuration: {
        baseURL: `${apiBaseUrl}/embeddings`,
      },
      model: 'text-embedding-v2',
    });
  }

  getChatModel(): ChatOpenAI {
    return this.chatModel;
  }

  getEmbeddings(): OpenAIEmbeddings {
    return this.embeddings;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
