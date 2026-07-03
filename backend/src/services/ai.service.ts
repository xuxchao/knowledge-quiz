import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class AiService implements OnModuleInit {
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
      throw new Error('QWEN_API_KEY environment variable is not set. Please configure it in the .env file.');
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
