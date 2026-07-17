import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, LogServiceCall } from '../common/logger';
import { Mem0MemoryRecord, Mem0Message, Mem0Service } from '../infrastructure/mem0/mem0.service';

export interface MemoryItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

type MemoryKind = '用户记忆' | '会话记忆';

@Injectable()
export class MemoryService {
  private readonly logger = new LoggerService(MemoryService.name);
  private readonly retryDelays = [200, 500, 1000];
  private readonly enabled: boolean;
  private readonly userTopK: number;
  private readonly conversationTopK: number;
  private readonly perScopeTokenBudget: number;

  constructor(
    private readonly mem0Service: Mem0Service,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<string>('MEM0_ENABLED', 'false') === 'true';
    this.userTopK = this.positiveNumber(configService.get<string>('MEM0_USER_MEMORY_TOP_K'), 10);
    this.conversationTopK = this.positiveNumber(configService.get<string>('MEM0_CONVERSATION_MEMORY_TOP_K'), 10);
    this.perScopeTokenBudget = this.positiveNumber(configService.get<string>('MEM0_MEMORY_SCOPE_TOKEN_BUDGET'), 2000);
  }

  @LogServiceCall()
  async getRelevantMemories(query: string, conversationId: string, userId: string): Promise<MemoryItem[]> {
    if (!this.enabled) return [];
    const [userRecords, conversationRecords] = await Promise.all([
      this.mem0Service.searchMemories(query, userId, this.userTopK),
      this.mem0Service.searchConversationMemories(query, conversationId, this.conversationTopK),
    ]);

    this.logger.info(
      `长期记忆检索完成 - 会话ID: ${conversationId}，用户记忆数: ${userRecords.length}，会话记忆数: ${conversationRecords.length}`,
    );
    return this.deduplicateMemories([
      ...this.limitToTokenBudget(this.mapRecords(userRecords)),
      ...this.limitToTokenBudget(this.mapRecords(conversationRecords)),
    ]);
  }

  @LogServiceCall()
  async saveUserMemory(userId: string, conversationId: string, messages: Mem0Message[]): Promise<void> {
    if (!this.enabled) return;
    await this.retryAndIgnore('用户记忆', conversationId, () =>
      this.mem0Service.addMemory(
        { userId },
        messages,
        { source: 'chat', conversationId, memoryScope: 'user' },
        '只提取长期稳定、可跨会话复用的用户身份、偏好、约束和目标。忽略临时问题、寒暄和助手陈述。',
      ),
    );
  }

  @LogServiceCall()
  async saveConversationMemory(conversationId: string, userId: string, messages: Mem0Message[]): Promise<void> {
    if (!this.enabled) return;
    await this.retryAndIgnore('会话记忆', conversationId, () =>
      this.mem0Service.addMemory(
        { runId: conversationId },
        messages,
        { source: 'chat', userId, memoryScope: 'conversation' },
        '提取本次会话中需要后续延续的重要事实、实体、决定、约束和未解决事项。忽略寒暄和重复内容。',
      ),
    );
  }

  @LogServiceCall()
  async deleteConversationMemory(conversationId: string): Promise<void> {
    if (!this.enabled) return;
    await this.retryAndIgnore('会话记忆', conversationId, () =>
      this.mem0Service.deleteConversationMemories(conversationId),
    );
  }

  private async retryAndIgnore(
    kind: MemoryKind,
    conversationId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    for (let attempt = 0; attempt <= this.retryDelays.length; attempt += 1) {
      try {
        await operation();
        if (attempt > 0) {
          this.logger.info(`${kind}重试成功 - 会话ID: ${conversationId}，重试次数: ${attempt}`);
        }
        return;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;
        if (attempt === this.retryDelays.length) {
          this.logger.error(
            `${kind}保存最终失败，已忽略 - 会话ID: ${conversationId}，总调用次数: ${attempt + 1}，错误: ${errorMessage}`,
            stackTrace,
          );
          return;
        }
        this.logger.warn(`${kind}调用失败，准备重试 - 会话ID: ${conversationId}，重试次数: ${attempt + 1}`);
        await this.delay(this.retryDelays[attempt]);
      }
    }
  }

  private mapRecords(records: Mem0MemoryRecord[]): MemoryItem[] {
    return records.map((memory) => ({
      id: memory.id,
      content: memory.memory,
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    }));
  }

  private deduplicateMemories(memories: MemoryItem[]): MemoryItem[] {
    const seen = new Set<string>();
    return memories.filter((memory) => {
      const key = memory.content.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private limitToTokenBudget(memories: MemoryItem[]): MemoryItem[] {
    let usedTokens = 0;
    return memories.filter((memory) => {
      const estimatedTokens = Math.ceil(Math.max(memory.content.length / 2, Buffer.byteLength(memory.content) / 3));
      if (usedTokens + estimatedTokens > this.perScopeTokenBudget) return false;
      usedTokens += estimatedTokens;
      return true;
    });
  }

  private positiveNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
