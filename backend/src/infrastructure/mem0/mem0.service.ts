import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, LogServiceCall } from '../../common/logger';

export interface Mem0Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Mem0MemoryScope {
  userId?: string;
  runId?: string;
}

export interface Mem0MemoryRecord {
  id: string;
  memory: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

interface Mem0ResultsResponse {
  results: unknown[];
}

export class Mem0RequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = Mem0RequestError.name;
  }
}

@Injectable()
export class Mem0Service {
  private readonly logger = new LoggerService(Mem0Service.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('MEM0_BASE_URL', 'http://localhost:8888').replace(/\/$/, '');
    this.apiKey = this.configService.get<string>('MEM0_API_KEY', 'knowledge-doc-mem0-local-api-key');
    this.timeoutMs = this.readTimeout(this.configService.get<string>('MEM0_TIMEOUT_MS'));
  }

  @LogServiceCall()
  async addMemory(
    scope: Mem0MemoryScope,
    messages: Mem0Message[],
    metadata: Record<string, unknown> = {},
    prompt?: string,
  ): Promise<void> {
    await this.request('/memories', {
      method: 'POST',
      body: JSON.stringify({
        messages,
        ...(scope.userId ? { user_id: scope.userId } : {}),
        ...(scope.runId ? { run_id: scope.runId } : {}),
        metadata,
        ...(prompt ? { prompt } : {}),
      }),
    });
  }

  @LogServiceCall()
  async searchMemories(query: string, userId: string, limit = 10): Promise<Mem0MemoryRecord[]> {
    return this.searchByScope(query, { userId }, limit);
  }

  @LogServiceCall()
  async searchConversationMemories(query: string, conversationId: string, limit = 10): Promise<Mem0MemoryRecord[]> {
    return this.searchByScope(query, { runId: conversationId }, limit);
  }

  @LogServiceCall()
  async deleteConversationMemories(conversationId: string): Promise<void> {
    const params = new URLSearchParams({ run_id: conversationId });
    await this.request(`/memories?${params.toString()}`, { method: 'DELETE' });
  }

  private async searchByScope(query: string, scope: Mem0MemoryScope, limit: number): Promise<Mem0MemoryRecord[]> {
    const response = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        filters: {
          ...(scope.userId ? { user_id: scope.userId } : {}),
          ...(scope.runId ? { run_id: scope.runId } : {}),
        },
        top_k: limit,
      }),
    });
    return this.parseResults(response);
  }

  @LogServiceCall()
  async getMemories(userId: string, limit = 10): Promise<Mem0MemoryRecord[]> {
    const params = new URLSearchParams({ user_id: userId, top_k: String(limit) });
    return this.parseResults(await this.request(`/memories?${params.toString()}`, { method: 'GET' }));
  }

  @LogServiceCall()
  async deleteMemories(userId: string): Promise<void> {
    const params = new URLSearchParams({ user_id: userId });
    await this.request(`/memories?${params.toString()}`, { method: 'DELETE' });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Mem0RequestError(`Mem0请求失败，状态码: ${response.status}`);
      }

      if (response.status === 204) return undefined;

      const text = await response.text();
      if (!text) return undefined;

      try {
        return JSON.parse(text) as unknown;
      } catch (error: unknown) {
        throw new Mem0RequestError('Mem0返回了无效JSON', { cause: error });
      }
    } catch (error: unknown) {
      const requestError = this.toRequestError(error);
      this.logger.error(`Mem0调用失败，错误: ${requestError.message}`, requestError.stack);
      throw requestError;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResults(payload: unknown): Mem0MemoryRecord[] {
    if (!this.isResultsResponse(payload)) {
      throw new Mem0RequestError('Mem0返回的数据结构无效');
    }

    return payload.results.map((value) => this.parseMemory(value));
  }

  private parseMemory(value: unknown): Mem0MemoryRecord {
    if (!this.isRecord(value) || typeof value.id !== 'string' || typeof value.memory !== 'string') {
      throw new Mem0RequestError('Mem0返回的记忆条目无效');
    }

    const createdAtValue = value.created_at;
    const createdAt =
      typeof createdAtValue === 'number'
        ? createdAtValue
        : typeof createdAtValue === 'string'
          ? Date.parse(createdAtValue)
          : 0;

    return {
      id: value.id,
      memory: value.memory,
      metadata: this.isRecord(value.metadata) ? value.metadata : {},
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    };
  }

  private toRequestError(error: unknown): Mem0RequestError {
    if (error instanceof Mem0RequestError) return error;
    if (this.isRecord(error) && error.name === 'AbortError') {
      return new Mem0RequestError(`Mem0请求超时（${this.timeoutMs}ms）`, { cause: error });
    }
    return new Mem0RequestError('无法连接Mem0服务', { cause: error });
  }

  private readTimeout(value: string | undefined): number {
    const parsed = Number(value ?? 30000);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  private isResultsResponse(value: unknown): value is Mem0ResultsResponse {
    return this.isRecord(value) && Array.isArray(value.results);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
