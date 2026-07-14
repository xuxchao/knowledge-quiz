import { Injectable, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { ConversationService } from '../conversations/conversation.service';
import { Message, MessageRole } from '../entities/message.entity';
import { LoggerService, LogServiceCall } from '../common/logger';
import { AiService, ConversationPromptMessage } from './ai.service';
import { TokenBudgetService } from './token-budget.service';

export interface PreparedConversationContext {
  messages: ConversationPromptMessage[];
  estimatedTokens: number;
  summarized: boolean;
}

@Injectable()
export class ConversationContextService {
  private readonly logger = new LoggerService(ConversationContextService.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly aiService: AiService,
    private readonly tokenBudget: TokenBudgetService,
  ) {}

  @LogServiceCall()
  validateUserMessage(content: string): number {
    const tokens = this.tokenBudget.countText(content);
    if (tokens + this.tokenBudget.maxOutputTokens >= this.tokenBudget.triggerTokens) {
      throw new PayloadTooLargeException('当前消息超过模型安全上下文预算');
    }
    return tokens;
  }

  @LogServiceCall()
  async prepare(
    conversationId: string,
    systemPrompt: string,
    callbacks: BaseCallbackHandler[] = [],
    retry = 0,
  ): Promise<PreparedConversationContext> {
    const snapshot = await this.conversationService.getContextSnapshot(conversationId);
    if (!snapshot) throw new ServiceUnavailableException('会话上下文不存在');

    const missingCounts = snapshot.messages.filter((message) => message.tokenCount == null);
    for (const message of missingCounts) {
      message.tokenCount = this.tokenBudget.countText(message.content);
    }
    if (missingCounts.length > 0) {
      await this.conversationService.updateMessageTokenCounts(missingCounts);
    }

    const promptMessages = this.buildPromptMessages(snapshot.conversation.summary, snapshot.messages);
    const estimatedTokens = this.tokenBudget.countPrompt(systemPrompt, promptMessages);
    this.logger.info(
      `上下文预算计算完成 - 会话ID: ${conversationId}，估算Token: ${estimatedTokens}，触发阈值: ${this.tokenBudget.triggerTokens}`,
    );
    if (estimatedTokens <= this.tokenBudget.triggerTokens) {
      return { messages: promptMessages, estimatedTokens, summarized: false };
    }

    const keepCount = Math.max(this.tokenBudget.recentMessagesMin, 1);
    if (snapshot.messages.length <= keepCount) {
      throw new PayloadTooLargeException('近期对话超过模型安全上下文预算，无法继续压缩');
    }

    let cutoff = snapshot.messages.length - keepCount;
    while (cutoff > 0 && snapshot.messages[cutoff - 1].role !== MessageRole.ASSISTANT) cutoff -= 1;
    if (cutoff === 0) {
      throw new PayloadTooLargeException('没有可安全摘要的完整历史回合');
    }
    const messagesToSummarize = snapshot.messages.slice(0, cutoff);
    const remainingMessages = snapshot.messages.slice(cutoff);
    const lastSummarized = messagesToSummarize[messagesToSummarize.length - 1];

    let summary: string;
    try {
      summary = await this.aiService.generateConversationSummary(
        snapshot.conversation.summary,
        this.toPromptMessages(messagesToSummarize),
        callbacks,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.logger.error(`会话摘要生成失败 - 会话ID: ${conversationId}，错误: ${errorMessage}`, stackTrace);
      throw new ServiceUnavailableException('会话摘要生成失败');
    }

    const updated = await this.conversationService.updateSummary(
      conversationId,
      snapshot.conversation.summaryVersion,
      summary,
      lastSummarized.id,
    );
    if (!updated) {
      if (retry >= 1) throw new ServiceUnavailableException('会话摘要并发更新失败');
      this.logger.warn(`会话摘要发生并发冲突，重新计算 - 会话ID: ${conversationId}`);
      return this.prepare(conversationId, systemPrompt, callbacks, retry + 1);
    }

    const compactedMessages = this.buildPromptMessages(summary, remainingMessages);
    const compactedTokens = this.tokenBudget.countPrompt(systemPrompt, compactedMessages);
    if (compactedTokens > this.tokenBudget.targetTokens) {
      throw new PayloadTooLargeException('摘要后的上下文仍超过目标预算');
    }

    this.logger.info(
      `会话摘要完成 - 会话ID: ${conversationId}，覆盖消息数: ${messagesToSummarize.length}，压缩后Token: ${compactedTokens}`,
    );
    return { messages: compactedMessages, estimatedTokens: compactedTokens, summarized: true };
  }

  private buildPromptMessages(summary: string | null, messages: Message[]): ConversationPromptMessage[] {
    return [
      ...(summary ? [{ role: 'system' as const, content: `此前会话摘要：\n${summary}` }] : []),
      ...this.toPromptMessages(messages),
    ];
  }

  private toPromptMessages(messages: Message[]): ConversationPromptMessage[] {
    return messages.map((message) => ({ role: message.role, content: message.content }));
  }
}
