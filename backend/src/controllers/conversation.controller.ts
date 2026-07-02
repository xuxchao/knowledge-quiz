import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ConversationService } from '../services/conversation.service';
import { AiService } from '../services/ai.service';
import { MemoryService } from '../services/memory.service';
import { Neo4jService } from '../services/neo4j.service';
import { MessageRole } from '../entities/message.entity';

interface ChatRequest {
  conversationId?: string;
  message: string;
  userId?: string;
}

interface SseMessage {
  type: 'message' | 'done' | 'error';
  content?: string;
  conversationId?: string;
  message?: string;
}

@Controller('conversations')
export class ConversationController {
  constructor(
    private conversationService: ConversationService,
    private aiService: AiService,
    private memoryService: MemoryService,
    private neo4jService: Neo4jService,
  ) {}

  @Get()
  async listConversations(@Query('userId') userId?: string) {
    const conversations = await this.conversationService.findAll(userId);
    return {
      success: true,
      data: conversations,
    };
  }

  @Get(':id')
  async getConversation(@Param('id') id: string) {
    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    }
    return {
      success: true,
      data: conversation,
    };
  }

  @Delete(':id')
  async deleteConversation(@Param('id') id: string) {
    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    }

    await this.conversationService.delete(id);
    await this.memoryService.clearShortTermMemory(id);

    return {
      success: true,
      message: 'Conversation deleted successfully',
    };
  }

  @Sse('chat')
  async chatSse(@Body() body: ChatRequest): Promise<Observable<SseMessage>> {
    let conversationId = body.conversationId;
    const userId = body.userId || 'default';

    if (!conversationId) {
      const conversation = await this.conversationService.create({
        userId,
      });
      conversationId = conversation.id;
    }

    await this.conversationService.createMessage(
      conversationId,
      MessageRole.USER,
      body.message,
    );
    await this.memoryService.saveShortTermMemory(conversationId, body.message);

    const memories = await this.memoryService.getRelevantMemories(
      body.message,
      conversationId,
      userId,
    );
    const memoryContext = memories.map((m) => m.content).join('\n');

    const queryEmbedding = await this.aiService.generateEmbedding(body.message);
    const relevantChunks = await this.neo4jService.search(queryEmbedding, 5);
    const chunkContext = relevantChunks.map((c) => c.content).join('\n');

    const systemPrompt = `你是一个知识问答助手。请根据以下上下文回答用户问题：

知识库内容：
${chunkContext}

历史对话记忆：
${memoryContext}

请用简洁、准确的语言回答用户问题。如果问题与知识库无关，请直接回答，无需强行关联。回答使用中文。`;

    return new Observable((observer) => {
      const chatModel = this.aiService.getChatModel();

      chatModel
        .stream([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: body.message },
        ])
        .then(async (stream) => {
          let fullResponse = '';

          for await (const chunk of stream) {
            const content = chunk.content?.toString() || '';
            fullResponse += content;

            observer.next({
              type: 'message',
              content,
              conversationId,
            });
          }

          await this.conversationService.createMessage(
            conversationId,
            MessageRole.ASSISTANT,
            fullResponse,
          );
          await this.memoryService.saveShortTermMemory(
            conversationId,
            fullResponse,
          );
          await this.memoryService.saveLongTermMemory(userId, fullResponse);

          observer.next({
            type: 'done',
            conversationId,
          });

          observer.complete();
        })
        .catch((error) => {
          observer.error({
            type: 'error',
            message: error.message,
          });
        });
    });
  }
}
