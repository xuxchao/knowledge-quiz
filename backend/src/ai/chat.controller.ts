import { Body, Controller, HttpException, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import { toUIMessageStream } from '@ai-sdk/langchain';
import { ConversationService } from '../conversations/conversation.service';
import { AiService } from './ai.service';
import { MemoryService } from '../memory/memory.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { LangfuseService } from '../infrastructure/langfuse/langfuse.service';
import { MessageRole } from '../entities/message.entity';
import { LoggerService } from '../common/logger';

interface ChatRequestBody {
  messages?: UIMessage[];
  conversationId?: string;
  userId?: string;
}

@Controller('conversations')
export class ChatController {
  private readonly logger = new LoggerService(ChatController.name);

  constructor(
    private conversationService: ConversationService,
    private aiService: AiService,
    private memoryService: MemoryService,
    private neo4jService: Neo4jService,
    private langfuseService: LangfuseService,
  ) {}

  @Post('chat')
  async chat(@Body() body: ChatRequestBody, @Res() response: Response): Promise<void> {
    let conversationId = body.conversationId;
    const message = this.extractLastUserMessage(body.messages);
    const userId = body.userId;

    this.logger.debug(
      `请求进入 - 对话聊天，会话ID: ${conversationId || '未提供'}, 用户ID: ${userId || '未提供'}, 消息: ${message?.substring(0, 50) || '无'}${(message?.length ?? 0) > 50 ? '...' : ''}`,
    );

    const uid = userId || 'default';

    if (!message?.trim()) {
      this.logger.warn('消息内容为空');
      throw new HttpException('Message cannot be empty', HttpStatus.BAD_REQUEST);
    }

    if (!conversationId) {
      const title = await this.aiService.generateConversationTitle(message);
      const conversation = await this.conversationService.create({
        userId: uid,
        title,
      });
      conversationId = conversation.id;
      this.logger.info(`新建会话 - ID: ${conversationId}, 标题: ${title}`);
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

    this.logger.info(`开始对话 - 会话ID: ${conversationId}, 用户ID: ${uid}, 用户消息长度: ${message.length}`);

    const langChainStream = await this.aiService.streamChain(message, systemPrompt);
    const langfuseTrace = this.langfuseService.startChatTrace({
      conversationId,
      userId: uid,
      message,
      systemPrompt,
    });
    const langfuseGeneration = this.langfuseService.startGeneration(langfuseTrace, 'qwen-plus', message);
    const aiSdkStream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({
          type: 'data-conversation-id',
          data: { conversationId },
          transient: true,
        });
        writer.merge(
          toUIMessageStream(langChainStream, {
            onFinal: async (fullResponse) => {
              await this.saveAssistantResponse(conversationId, uid, fullResponse);
              this.langfuseService.completeGeneration(langfuseTrace, langfuseGeneration, fullResponse);
              await this.langfuseService.flush();
            },
            onError: async (error) => {
              this.logger.error(`对话流处理失败 - 会话ID: ${conversationId}，错误: ${error.message}`, error.stack);
              this.langfuseService.failGeneration(langfuseGeneration, error.message, langfuseTrace);
              await this.langfuseService.flush();
            },
          }),
        );
      },
      onError: (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`对话响应生成失败 - 会话ID: ${conversationId}，错误: ${errorMessage}`);
        this.langfuseService.failGeneration(langfuseGeneration, errorMessage, langfuseTrace);
        return '对话响应生成失败';
      },
    });

    pipeUIMessageStreamToResponse({
      response,
      stream: aiSdkStream,
    });
  }

  private extractLastUserMessage(messages: UIMessage[] | undefined): string {
    const lastUserMessage = [...(messages ?? [])].reverse().find((message) => message.role === 'user');
    const textParts = lastUserMessage?.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text);

    return textParts?.join('').trim() ?? '';
  }

  private async saveAssistantResponse(conversationId: string, userId: string, fullResponse: string): Promise<void> {
    if (!fullResponse.trim()) {
      this.logger.warn(`对话响应为空 - 会话ID: ${conversationId}`);
      return;
    }

    try {
      await this.conversationService.createMessage(conversationId, MessageRole.ASSISTANT, fullResponse);
      await this.memoryService.saveShortTermMemory(conversationId, fullResponse);
      this.memoryService.saveLongTermMemory(userId, fullResponse);
      this.logger.info(`对话完成 - 会话ID: ${conversationId}, 响应长度: ${fullResponse.length}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.logger.error(`对话完成后保存失败 - 会话ID: ${conversationId}，错误: ${errorMessage}`, stackTrace);
    }
  }
}
