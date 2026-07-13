import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { RedisService } from './redis.service';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

describe('RedisService', () => {
  const connect = jest.fn();
  const quit = jest.fn();
  const on = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue({ connect, quit, on });
  });

  it('默认连接 Redis DB 0', async () => {
    const configService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    } as unknown as ConfigService;
    const service = new RedisService(configService);

    await service.onModuleInit();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'redis://localhost:6379',
        password: undefined,
        database: 0,
      }),
    );
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('使用 REDIS_DB 指定的逻辑数据库', async () => {
    const values: Record<string, string> = {
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
      REDIS_DB: '2',
    };
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => values[key] ?? defaultValue),
    } as unknown as ConfigService;
    const service = new RedisService(configService);

    await service.onModuleInit();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'redis://redis:6379',
        password: undefined,
        database: 2,
      }),
    );
  });

  it('拒绝无效的 REDIS_DB', async () => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => (key === 'REDIS_DB' ? 'invalid' : defaultValue)),
    } as unknown as ConfigService;
    const service = new RedisService(configService);

    await expect(service.onModuleInit()).rejects.toThrow('REDIS_DB 必须是非负整数');
    expect(createClient).not.toHaveBeenCalled();
  });
});
