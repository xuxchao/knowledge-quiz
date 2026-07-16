import { Body, Controller, HttpException, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import { DocumentReference } from '../entities/message.entity';
import { LoggerService } from '../common/logger';
import { RagChatGraph } from './rag-chat.graph';

interface ChatDataParts {
  [key: string]: unknown;
  'conversation-id': { conversationId: string };
  citations: { citations: DocumentReference[] };
}

type ChatUIMessage = UIMessage<unknown, ChatDataParts>;

interface ChatRequestBody {
  messages?: ChatUIMessage[];
  conversationId?: string;
  userId?: string;
  documentIds?: string[];
}

@Controller('conversations')
export class ChatController {
  private readonly logger = new LoggerService(ChatController.name);

  constructor(private readonly ragChatGraph: RagChatGraph) {}

  @Post('chat')
  async chat(@Body() body: ChatRequestBody, @Res() response: Response): Promise<void> {
    const message = this.extractLastUserMessage(body.messages);
    const userId = body.userId || 'default';
    this.logger.debug(
      `请求进入 - LangGraph对话，会话ID: ${body.conversationId || '未提供'}，用户ID: ${userId}，消息长度: ${message.length}`,
    );
    if (!message) {
      this.logger.warn('消息内容为空');
      throw new HttpException('Message cannot be empty', HttpStatus.BAD_REQUEST);
    }

    const abortController = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) abortController.abort();
    });
    const textPartId = `answer-${Date.now()}`;
    const stream = createUIMessageStream<ChatUIMessage>({
      execute: async ({ writer }) => {
        let textStarted = false;
        for await (const event of this.ragChatGraph.stream(
          {
            conversationId: body.conversationId,
            userId,
            message,
            documentIds: body.documentIds,
          },
          abortController.signal,
        )) {
          if (event.type === 'conversation-id') {
            writer.write({
              type: 'data-conversation-id',
              data: { conversationId: event.conversationId },
              transient: true,
            });
          } else if (event.type === 'citations') {
            writer.write({ type: 'data-citations', data: { citations: event.citations } });
          } else if (event.type === 'token') {
            if (!textStarted) {
              writer.write({ type: 'text-start', id: textPartId });
              textStarted = true;
            }
            writer.write({ type: 'text-delta', id: textPartId, delta: event.token });
          } else if (event.type === 'final' && textStarted) {
            writer.write({ type: 'text-end', id: textPartId });
          }
        }
      },
      onError: (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `LangGraph对话响应失败 - 错误: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
        return '对话响应生成失败';
      },
    });

    pipeUIMessageStreamToResponse({ response, stream });
    this.logger.info(`请求成功 - LangGraph对话流已建立，会话ID: ${body.conversationId || '新会话'}`);
  }

  private extractLastUserMessage(messages: ChatUIMessage[] | undefined): string {
    const lastUserMessage = [...(messages ?? [])].reverse().find((message) => message.role === 'user');
    return (
      lastUserMessage?.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim() ?? ''
    );
  }
}
