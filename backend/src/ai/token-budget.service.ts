import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogServiceCall } from '../common/logger';
import type { ConversationPromptMessage } from './ai.service';

@Injectable()
export class TokenBudgetService {
  readonly contextWindow: number;
  readonly triggerTokens: number;
  readonly targetTokens: number;
  readonly maxOutputTokens: number;
  readonly recentMessagesMin: number;

  constructor(configService: ConfigService) {
    this.contextWindow = this.positiveNumber(configService.get<string>('AI_CONTEXT_WINDOW_TOKENS'), 131072);
    this.maxOutputTokens = this.positiveNumber(configService.get<string>('AI_MAX_OUTPUT_TOKENS'), 4096);
    this.recentMessagesMin = this.positiveNumber(configService.get<string>('AI_RECENT_MESSAGES_MIN'), 8);
    const triggerRatio = this.ratio(configService.get<string>('AI_CONTEXT_SUMMARY_TRIGGER_RATIO'), 0.7);
    const targetRatio = this.ratio(configService.get<string>('AI_CONTEXT_TARGET_RATIO'), 0.5);
    this.triggerTokens = Math.floor(this.contextWindow * triggerRatio);
    this.targetTokens = Math.floor(this.contextWindow * targetRatio);
  }

  @LogServiceCall()
  countText(content: string): number {
    if (!content) return 0;
    const characterEstimate = Math.ceil(content.length / 2);
    const utf8Estimate = Math.ceil(Buffer.byteLength(content, 'utf8') / 3);
    return Math.ceil(Math.max(characterEstimate, utf8Estimate) * 1.1);
  }

  @LogServiceCall()
  countPrompt(systemPrompt: string, messages: ConversationPromptMessage[]): number {
    const messageTokens = messages.reduce((total, message) => total + this.countText(message.content) + 6, 0);
    return this.countText(systemPrompt) + messageTokens + this.maxOutputTokens + 12;
  }

  private positiveNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private ratio(value: string | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback;
  }
}
