import { Injectable } from '@nestjs/common';
import { RedisService } from '../infrastructure/redis/redis.service';
import { LoggerService, LogServiceCall } from '../common/logger';

export interface MemoryItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

@Injectable()
export class MemoryService {
  private readonly logger = new LoggerService(MemoryService.name);
  private shortTermMemoryTtl = 3600;
  private longTermMemoryStore: Map<string, MemoryItem[]> = new Map();

  constructor(private redisService: RedisService) {}

  @LogServiceCall()
  async saveShortTermMemory(
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const key = `memory:short:${conversationId}`;
    const item: MemoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      metadata: metadata || {},
      createdAt: Date.now(),
    };

    const existing = await this.redisService.get(key);
    const memories: MemoryItem[] = existing ? (JSON.parse(existing) as MemoryItem[]) : [];
    memories.push(item);

    if (memories.length > 50) {
      memories.shift();
    }

    await this.redisService.set(key, JSON.stringify(memories), this.shortTermMemoryTtl);
  }

  @LogServiceCall()
  async getShortTermMemory(conversationId: string): Promise<MemoryItem[]> {
    const key = `memory:short:${conversationId}`;
    const existing = await this.redisService.get(key);
    if (!existing) {
      return [];
    }
    try {
      const memories: MemoryItem[] = JSON.parse(existing) as MemoryItem[];
      return memories.map((item) => ({
        ...item,
        createdAt: typeof item.createdAt === 'string' ? new Date(item.createdAt).getTime() : item.createdAt,
      }));
    } catch {
      return [];
    }
  }

  @LogServiceCall()
  saveLongTermMemory(userId: string, content: string, metadata?: Record<string, unknown>) {
    const item: MemoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      metadata: metadata || {},
      createdAt: Date.now(),
    };

    const memories = this.longTermMemoryStore.get(userId) || [];
    memories.push(item);

    if (memories.length > 1000) {
      memories.shift();
    }

    this.longTermMemoryStore.set(userId, memories);
  }

  @LogServiceCall()
  getLongTermMemory(userId: string) {
    return this.longTermMemoryStore.get(userId) || [];
  }

  @LogServiceCall()
  async getRelevantMemories(query: string, conversationId: string, userId: string = 'default'): Promise<MemoryItem[]> {
    const shortTerm = await this.getShortTermMemory(conversationId);
    let longTerm = this.getLongTermMemory(userId);

    if (!Array.isArray(longTerm)) {
      this.logger.warn(`长时记忆格式异常（非数组） - userId: ${userId}`, longTerm);
      longTerm = [];
    }

    const allMemories = [...shortTerm, ...longTerm];

    return allMemories.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  }

  @LogServiceCall()
  async clearShortTermMemory(conversationId: string): Promise<void> {
    const key = `memory:short:${conversationId}`;
    await this.redisService.del(key);
  }

  @LogServiceCall()
  clearLongTermMemory(userId: string) {
    this.longTermMemoryStore.delete(userId);
  }
}
