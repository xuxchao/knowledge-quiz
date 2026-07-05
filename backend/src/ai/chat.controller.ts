import { Controller, Sse, Query, HttpException, HttpStatus } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { map, finalize, endWith } from 'rxjs/operators';
import { ConversationService } from '../conversations/conversation.service';
import { AiService } from './ai.service';
import { MemoryService } from '../memory/memory.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { MessageRole } from '../entities/message.entity';
import { LoggerService } from '../common/logger';

@Controller('conversations')
export class ChatController {
  private readonly logger = new LoggerService(ChatController.name);

  constructor(
    private conversationService: ConversationService,
    private aiService: AiService,
    private memoryService: MemoryService,
    private neo4jService: Neo4jService,
  ) {}

  @Sse('chat')
  async chatSse(
    @Query('conversationId') conversationId?: string,
    @Query('message') message?: string,
    @Query('userId') userId?: string,
  ): Promise<Observable<{ data: string }>> {
    this.logger.debug(`请求进入 - 对话聊天，会话ID: ${conversationId || '未提供'}, 用户ID: ${userId || '未提供'}, 消息: ${message?.substring(0, 50) || '无'}${(message?.length ?? 0) > 50 ? '...' : ''}`);

    const uid = userId || 'default';

    if (!message?.trim()) {
      this.logger.warn('消息内容为空');
      throw new HttpException('Message cannot be empty', HttpStatus.BAD_REQUEST);
    }

    if (!conversationId) {
      const conversation = await this.conversationService.create({
        userId: uid,
      });
      conversationId = conversation.id;
      this.logger.info(`新建会话 - ID: ${conversationId}`);
    }

    await this.conversationService.createMessage(conversationId, MessageRole.USER, message);
    await this.memoryService.saveShortTermMemory(conversationId, message);

    const memories = await this.memoryService.getRelevantMemories(message, conversationId, uid);
    const memoryContext = memories.map((m) => m.content).join('\n');

    const queryEmbedding = await this.aiService.generateEmbedding(message);
    const relevantChunks = await this.neo4jService.search(queryEmbedding, 5);
    const chunkContext = relevantChunks.map((c) => c.content).join('\n');

    const systemPrompt = `你是一个知识问答助手。请根据以下上下文回答用户问题：

知识库内容：
${chunkContext}

历史对话记忆：
${memoryContext}

请用简洁、准确的语言回答用户问题。如果问题与知识库无关，请直接回答，无需强行关联。回答使用中文。`;

    let fullResponse = '';

    return from(this.aiService.streamChain(message, systemPrompt)).pipe(
      map((chunk) => {
        fullResponse += chunk;
        return {
          data: JSON.stringify({
            type: 'message' as const,
            content: chunk,
            conversationId,
          }),
        };
      }),
      endWith({
        data: JSON.stringify({
          type: 'done' as const,
          content: '',
          conversationId,
        }),
      }),
      finalize(() => {
        void (async () => {
          try {
            await this.conversationService.createMessage(conversationId, MessageRole.ASSISTANT, fullResponse);
            await this.memoryService.saveShortTermMemory(conversationId, fullResponse);
            this.memoryService.saveLongTermMemory(uid, fullResponse);
            this.logger.info(`对话完成 - 会话ID: ${conversationId}, 响应长度: ${fullResponse.length}`);
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const stackTrace = error instanceof Error ? error.stack : undefined;
            this.logger.error(`对话完成后保存失败 - 会话ID: ${conversationId}，错误: ${errorMessage}`, stackTrace);
          }
        })();
      }),
    );
  }
}