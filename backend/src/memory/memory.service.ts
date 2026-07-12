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

    await this.redisService.lpush(key, JSON.stringify(item));
    await this.redisService.ltrim(key, 0, 49);
    await this.redisService.expire(key, this.shortTermMemoryTtl);
  }

  @LogServiceCall()
  async getShortTermMemory(conversationId: string): Promise<MemoryItem[]> {
    const key = `memory:short:${conversationId}`;
    return this.parseMemories(await this.redisService.lrange(key, 0, 49));
  }

  @LogServiceCall()
  async saveLongTermMemory(userId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const item: MemoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      metadata: metadata || {},
      createdAt: Date.now(),
    };

    const key = `memory:long:${userId}`;
    await this.redisService.lpush(key, JSON.stringify(item));
    await this.redisService.ltrim(key, 0, 999);
  }

  @LogServiceCall()
  async getLongTermMemory(userId: string): Promise<MemoryItem[]> {
    return this.parseMemories(await this.redisService.lrange(`memory:long:${userId}`, 0, 999));
  }

  @LogServiceCall()
  async getRelevantMemories(query: string, conversationId: string, userId: string = 'default'): Promise<MemoryItem[]> {
    const shortTerm = await this.getShortTermMemory(conversationId);
    const longTerm = await this.getLongTermMemory(userId);

    const allMemories = [...shortTerm, ...longTerm];

    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return allMemories
      .map((memory) => ({
        memory,
        score: terms.reduce((score, term) => score + (memory.content.toLocaleLowerCase().includes(term) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
      .slice(0, 20)
      .map(({ memory }) => memory);
  }

  @LogServiceCall()
  async clearShortTermMemory(conversationId: string): Promise<void> {
    const key = `memory:short:${conversationId}`;
    await this.redisService.del(key);
  }

  @LogServiceCall()
  async clearLongTermMemory(userId: string): Promise<void> {
    await this.redisService.del(`memory:long:${userId}`);
  }

  private parseMemories(values: string[]): MemoryItem[] {
    return values.flatMap((value) => {
      try {
        const item = JSON.parse(value) as MemoryItem;
        return [{ ...item, createdAt: Number(item.createdAt) }];
      } catch {
        this.logger.warn('记忆数据解析失败，已忽略损坏条目');
        return [];
      }
    });
  }
}
