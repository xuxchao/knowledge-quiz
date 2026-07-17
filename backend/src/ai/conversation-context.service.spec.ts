import { PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { ConversationContextService } from './conversation-context.service';
import { ConversationService } from '../conversations/conversation.service';
import { AiService } from './ai.service';
import { TokenBudgetService } from './token-budget.service';
import { MessageRole } from '../entities/message.entity';

describe('ConversationContextService', () => {
  let service: ConversationContextService;
  let conversationService: jest.Mocked<ConversationService>;
  let aiService: jest.Mocked<AiService>;
  let tokenBudget: jest.Mocked<TokenBudgetService>;

  beforeEach(() => {
    conversationService = {
      getContextSnapshot: jest.fn(),
      updateMessageTokenCounts: jest.fn().mockResolvedValue(undefined),
      updateSummary: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ConversationService>;
    aiService = {
      generateConversationSummary: jest.fn().mockResolvedValue('压缩后的摘要'),
    } as unknown as jest.Mocked<AiService>;
    tokenBudget = {
      contextWindow: 1000,
      triggerTokens: 700,
      targetTokens: 500,
      maxOutputTokens: 100,
      recentMessagesMin: 8,
      countText: jest.fn().mockReturnValue(10),
      countPrompt: jest.fn(),
    } as unknown as jest.Mocked<TokenBudgetService>;
    service = new ConversationContextService(conversationService, aiService, tokenBudget);
  });

  it('uses PostgreSQL messages directly below the summary threshold', async () => {
    conversationService.getContextSnapshot.mockResolvedValue(snapshot(4));
    tokenBudget.countPrompt.mockReturnValue(600);

    const result = await service.prepare('conv-1', 'system');

    expect(result.summarized).toBe(false);
    expect(result.messages).toHaveLength(4);
    expect(aiService.generateConversationSummary).not.toHaveBeenCalled();
    expect(conversationService.updateMessageTokenCounts).toHaveBeenCalled();
  });

  it('summarizes the oldest messages and keeps the latest eight', async () => {
    conversationService.getContextSnapshot.mockResolvedValue(snapshot(12));
    tokenBudget.countPrompt.mockReturnValueOnce(800).mockReturnValueOnce(450);

    const result = await service.prepare('conv-1', 'system');

    expect(aiService.generateConversationSummary).toHaveBeenCalledWith(null, expect.any(Array), undefined);
    expect(conversationService.updateSummary).toHaveBeenCalledWith('conv-1', 0, '压缩后的摘要', 'msg-4');
    expect(result.summarized).toBe(true);
    expect(result.messages).toHaveLength(9);
    expect(result.messages[0].content).toContain('压缩后的摘要');
  });

  it('re-reads the snapshot once after an optimistic-lock conflict', async () => {
    conversationService.getContextSnapshot.mockResolvedValueOnce(snapshot(12)).mockResolvedValueOnce({
      ...snapshot(8),
      conversation: { ...snapshot(8).conversation, summary: '其他请求生成的摘要', summaryVersion: 1 },
    });
    conversationService.updateSummary.mockResolvedValue(false);
    tokenBudget.countPrompt.mockReturnValueOnce(800).mockReturnValueOnce(500);

    const result = await service.prepare('conv-1', 'system');

    expect(conversationService.getContextSnapshot).toHaveBeenCalledTimes(2);
    expect(result.summarized).toBe(false);
  });

  it('fails before model streaming when summary generation fails', async () => {
    conversationService.getContextSnapshot.mockResolvedValue(snapshot(12));
    tokenBudget.countPrompt.mockReturnValue(800);
    aiService.generateConversationSummary.mockRejectedValue(new Error('model unavailable'));

    await expect(service.prepare('conv-1', 'system')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a single user message that consumes the safe budget', () => {
    tokenBudget.countText.mockReturnValue(650);

    expect(() => service.validateUserMessage('large')).toThrow(PayloadTooLargeException);
  });

  function snapshot(messageCount: number) {
    return {
      conversation: {
        id: 'conv-1',
        summary: null,
        summaryVersion: 0,
        summaryThroughMessageId: null,
      } as never,
      messages: Array.from({ length: messageCount }, (_, index) => ({
        id: `msg-${index + 1}`,
        role: index % 2 === 0 ? MessageRole.USER : MessageRole.ASSISTANT,
        content: `message ${index + 1}`,
        tokenCount: null,
      })) as never,
    };
  }
});
