import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MemoryService } from './memory.service';
import { RedisService } from '../infrastructure/redis/redis.service';

describe('MemoryService', () => {
  let service: MemoryService;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const lists = new Map<string, string[]>();
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      providers: [
        MemoryService,
        {
          provide: RedisService,
          useValue: {
            lpush: jest.fn().mockImplementation(async (key: string, value: string) => {
              lists.set(key, [value, ...(lists.get(key) || [])]);
            }),
            lrange: jest
              .fn()
              .mockImplementation(async (key: string, start: number, end: number) =>
                (lists.get(key) || []).slice(start, end + 1),
              ),
            ltrim: jest.fn().mockImplementation(async (key: string, start: number, end: number) => {
              lists.set(key, (lists.get(key) || []).slice(start, end + 1));
            }),
            expire: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockImplementation(async (key: string) => {
              lists.delete(key);
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('saveShortTermMemory', () => {
    it('should save memory successfully', async () => {
      await service.saveShortTermMemory('conv-1', 'test content');
      expect(redisService.lpush).toHaveBeenCalled();
      expect(redisService.ltrim).toHaveBeenCalledWith('memory:short:conv-1', 0, 49);
      expect(redisService.expire).toHaveBeenCalledWith('memory:short:conv-1', 3600);
    });

    it('should handle empty content', async () => {
      await service.saveShortTermMemory('conv-1', '');
      expect(redisService.lpush).toHaveBeenCalled();
    });

    it('should handle empty conversation id', async () => {
      await service.saveShortTermMemory('', 'test content');
      expect(redisService.lpush).toHaveBeenCalled();
    });
  });

  describe('getShortTermMemory', () => {
    it('should return empty array if no memory', async () => {
      const result = await service.getShortTermMemory('non-existent');
      expect(result).toEqual([]);
      expect(redisService.lrange).toHaveBeenCalledWith('memory:short:non-existent', 0, 49);
    });

    it('should return memories if they exist', async () => {
      const mockMemories = [{ id: '1', content: 'test', metadata: {}, createdAt: 1234567890 }];
      jest.spyOn(redisService, 'lrange').mockResolvedValue(mockMemories.map(JSON.stringify));
      const result = await service.getShortTermMemory('conv-1');
      expect(result).toEqual(mockMemories);
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('test');
      expect(result[0].id).toBe('1');
      expect(redisService.lrange).toHaveBeenCalledWith('memory:short:conv-1', 0, 49);
    });

    it('should return empty array if redis returns invalid JSON', async () => {
      jest.spyOn(redisService, 'lrange').mockResolvedValue(['invalid json']);
      const result = await service.getShortTermMemory('conv-1');
      expect(result).toEqual([]);
    });

    it('should handle empty conversation id', async () => {
      const result = await service.getShortTermMemory('');
      expect(result).toEqual([]);
    });
  });

  describe('saveLongTermMemory', () => {
    it('should save memory successfully', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.saveLongTermMemory('user-1', 'test content');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('test content');
    });

    it('should handle empty content', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.saveLongTermMemory('user-1', '');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('');
    });

    it('should handle empty user id', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.saveLongTermMemory('', 'test content');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('');
      expect(result).toHaveLength(1);
    });
  });

  describe('getLongTermMemory', () => {
    it('should return empty array if no memory', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('non-existent');
      expect(result).toEqual([]);
    });

    it('should return memories if they exist', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.saveLongTermMemory('user-1', 'test content');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('user-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].content).toBe('test content');
    });

    it('should handle empty user id', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('');
      expect(result).toEqual([]);
    });
  });

  describe('getRelevantMemories', () => {
    it('should return relevant memories', async () => {
      const result = await service.getRelevantMemories('test', 'conv-1', 'user-1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty query', async () => {
      const result = await service.getRelevantMemories('', 'conv-1', 'user-1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty conversation id', async () => {
      const result = await service.getRelevantMemories('test', '', 'user-1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('clearShortTermMemory', () => {
    it('should clear memory successfully', async () => {
      jest.spyOn(redisService, 'del').mockResolvedValue();
      await service.clearShortTermMemory('conv-1');
      expect(redisService.del).toHaveBeenCalledWith('memory:short:conv-1');
    });

    it('should handle empty conversation id', async () => {
      jest.spyOn(redisService, 'del').mockResolvedValue();
      await service.clearShortTermMemory('');
      expect(redisService.del).toHaveBeenCalled();
    });
  });

  describe('clearLongTermMemory', () => {
    it('should clear memory successfully', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.saveLongTermMemory('user-1', 'test content');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const beforeResult = await service.getLongTermMemory('user-1');
      expect(beforeResult.length).toBe(1);

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.clearLongTermMemory('user-1');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const afterResult = await service.getLongTermMemory('user-1');
      expect(afterResult).toEqual([]);
    });

    it('should handle empty user id', async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.saveLongTermMemory('', 'test content');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await service.clearLongTermMemory('');
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const result = await service.getLongTermMemory('');
      expect(result).toEqual([]);
    });
  });
});
