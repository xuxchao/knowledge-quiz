import {
  Controller,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  HttpException,
  HttpStatus,
  Logger,
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
  private readonly logger = new Logger(ConversationController.name);

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

  @Sse('chat')
  async chatSse(
    @Query('conversationId') conversationId?: string,
    @Query('message') message?: string,
    @Query('userId') userId?: string,
  ): Promise<Observable<SseMessage>> {
    this.logger.log(
      `[chatSse] 方法调用开始 - conversationId: ${conversationId || '未提供'}, userId: ${userId || '未提供'}, message: ${message?.substring(0, 50)}${(message?.length ?? 0) > 50 ? '...' : ''}`,
    );

    const uid = userId || 'default';

    if (!message?.trim()) {
      this.logger.warn('[chatSse] 消息内容为空，返回错误');
      throw new HttpException('Message cannot be empty', HttpStatus.BAD_REQUEST);
    }

    if (!conversationId) {
      this.logger.log('[chatSse] 未提供 conversationId，创建新对话');
      const conversation = await this.conversationService.create({
        userId: uid,
      });
      conversationId = conversation.id;
      this.logger.log(`[chatSse] 新对话创建成功 - conversationId: ${conversationId}`);
    }

    this.logger.log(`[chatSse] 创建用户消息 - conversationId: ${conversationId}, message: ${message?.substring(0, 100)}${message?.length > 100 ? '...' : ''}`);
    await this.conversationService.createMessage(
      conversationId,
      MessageRole.USER,
      message,
    );

    this.logger.log(`[chatSse] 保存短期记忆 - conversationId: ${conversationId}`);
    await this.memoryService.saveShortTermMemory(conversationId, message);

    this.logger.log(`[chatSse] 获取相关记忆 - conversationId: ${conversationId}, userId: ${uid}`);
    const memories = await this.memoryService.getRelevantMemories(
      message,
      conversationId,
      uid,
    );
    const memoryContext = memories.map((m) => m.content).join('\n');
    this.logger.log(`[chatSse] 获取到 ${memories.length} 条相关记忆`);

    this.logger.log('[chatSse] 生成查询嵌入向量');
    const queryEmbedding = await this.aiService.generateEmbedding(message);

    this.logger.log('[chatSse] 搜索相关知识库块');
    const relevantChunks = await this.neo4jService.search(queryEmbedding, 5);
    const chunkContext = relevantChunks.map((c) => c.content).join('\n');
    this.logger.log(`[chatSse] 搜索到 ${relevantChunks.length} 条相关知识库块`);

    const systemPrompt = `你是一个知识问答助手。请根据以下上下文回答用户问题：

知识库内容：
${chunkContext}

历史对话记忆：
${memoryContext}

请用简洁、准确的语言回答用户问题。如果问题与知识库无关，请直接回答，无需强行关联。回答使用中文。`;

    this.logger.log(`[chatSse] 开始AI流式响应 - conversationId: ${conversationId}`);

    return new Observable((observer) => {
      const chatModel = this.aiService.getChatModel();

      chatModel
        .stream([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ])
        .then(async (stream) => {
          let fullResponse = '';

          for await (const chunk of stream) {
            const content =
              typeof chunk.content === 'string'
                ? chunk.content
                : JSON.stringify(chunk.content || '');
            fullResponse += content;

            observer.next({
              type: 'message',
              content,
              conversationId,
            });
          }

          this.logger.log(`[chatSse] AI响应完成，保存助手消息 - conversationId: ${conversationId}`);
          await this.conversationService.createMessage(
            conversationId,
            MessageRole.ASSISTANT,
            fullResponse,
          );

          this.logger.log(`[chatSse] 保存短期记忆 - conversationId: ${conversationId}`);
          await this.memoryService.saveShortTermMemory(
            conversationId,
            fullResponse,
          );

          this.logger.log(`[chatSse] 保存长期记忆 - userId: ${uid}`);
          this.memoryService.saveLongTermMemory(uid, fullResponse);

          observer.next({
            type: 'done',
            conversationId,
          });

          this.logger.log(`[chatSse] 方法调用结束 - conversationId: ${conversationId}, responseLength: ${fullResponse.length}`);
          observer.complete();
        })
        .catch((error: Error) => {
          this.logger.error(`[chatSse] AI流式响应异常 - conversationId: ${conversationId}, error: ${error.message}`, error.stack);
          observer.error({
            type: 'error',
            message: error.message,
          });
        });
    });
  }

  @Get('get/:id')
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

  @Delete('delete/:id')
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
}
