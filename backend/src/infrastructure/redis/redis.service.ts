import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { LoggerService, LogServiceCall } from '../../common/logger';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(RedisService.name);
  private client!: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const database = Number(this.configService.get<string>('REDIS_DB', '0'));

    if (!Number.isInteger(database) || database < 0) {
      throw new Error('REDIS_DB 必须是非负整数');
    }

    this.client = createClient({
      url: `redis://${host}:${port}`,
      password: password || undefined,
      database,
      socket: {
        // 连接被重置时自动重连，避免 ECONNRESET 直接崩溃进程
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            this.logger.error('Redis重连次数过多，放弃重连');
            return new Error('Redis重连次数过多');
          }
          this.logger.warn(`Redis连接断开，第${retries}次重连...`);
          return Math.min(retries * 200, 2000);
        },
      },
    });

    // 必须注册 error 事件监听器，否则未捕获的 error 事件会导致进程崩溃
    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis客户端错误: ${err.message}`);
    });

    await this.client.connect();
    this.logger.info('Redis服务初始化完成');
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.info('Redis连接已关闭');
  }

  getClient(): RedisClientType {
    return this.client;
  }

  @LogServiceCall()
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  @LogServiceCall()
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.set(key, value, { EX: ttl });
    } else {
      await this.client.set(key, value);
    }
  }

  @LogServiceCall()
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  @LogServiceCall()
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  @LogServiceCall()
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hGet(key, field);
  }

  @LogServiceCall()
  async hset(key: string, field: string, value: string): Promise<void> {
    await this.client.hSet(key, field, value);
  }

  @LogServiceCall()
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hGetAll(key);
  }

  @LogServiceCall()
  async lpush(key: string, ...values: string[]): Promise<void> {
    await this.client.lPush(key, values);
  }

  @LogServiceCall()
  async lrange(key: string, start: number, end: number): Promise<string[]> {
    return this.client.lRange(key, start, end);
  }

  // @LogServiceCall()
  async rpop(key: string): Promise<string | null> {
    return this.client.rPop(key);
  }

  @LogServiceCall()
  async ltrim(key: string, start: number, end: number): Promise<void> {
    await this.client.lTrim(key, start, end);
  }

  @LogServiceCall()
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  @LogServiceCall()
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  @LogServiceCall()
  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }
}
