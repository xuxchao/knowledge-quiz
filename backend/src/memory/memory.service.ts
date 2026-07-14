import { Injectable } from '@nestjs/common';
import { RedisService } from '../infrastructure/redis/redis.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { Mem0Message, Mem0Service } from '../infrastructure/mem0/mem0.service';

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

  constructor(
    private readonly redisService: RedisService,
    private readonly mem0Service: Mem0Service,
  ) {}

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
  async saveLongTermMemory(userId: string, messages: Mem0Message[], metadata?: Record<string, unknown>): Promise<void> {
    await this.mem0Service.addMemory(userId, messages, metadata);
  }

  @LogServiceCall()
  async getLongTermMemory(userId: string): Promise<MemoryItem[]> {
    const memories = await this.mem0Service.getMemories(userId, 10);
    return memories.map((memory) => ({
      id: memory.id,
      content: memory.memory,
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    }));
  }

  @LogServiceCall()
  async getRelevantMemories(query: string, conversationId: string, userId: string = 'default'): Promise<MemoryItem[]> {
    const [shortTerm, longTermRecords] = await Promise.all([
      this.getShortTermMemory(conversationId),
      query.trim() ? this.mem0Service.searchMemories(query, userId, 10) : this.mem0Service.getMemories(userId, 10),
    ]);
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const relevantShortTerm = shortTerm
      .map((memory) => ({
        memory,
        score: terms.reduce((score, term) => score + (memory.content.toLocaleLowerCase().includes(term) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
      .slice(0, 10)
      .map(({ memory }) => memory);

    const longTerm = longTermRecords.map((memory) => ({
      id: memory.id,
      content: memory.memory,
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    }));

    return this.deduplicateMemories([...relevantShortTerm, ...longTerm]).slice(0, 20);
  }

  @LogServiceCall()
  async clearShortTermMemory(conversationId: string): Promise<void> {
    const key = `memory:short:${conversationId}`;
    await this.redisService.del(key);
  }

  @LogServiceCall()
  async clearLongTermMemory(userId: string): Promise<void> {
    await this.mem0Service.deleteMemories(userId);
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

  private deduplicateMemories(memories: MemoryItem[]): MemoryItem[] {
    const seen = new Set<string>();
    return memories.filter((memory) => {
      const key = memory.content.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
