import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { Mem0Service } from '../infrastructure/mem0/mem0.service';

describe('MemoryService', () => {
  let service: MemoryService;
  let redisService: jest.Mocked<RedisService>;
  let mem0Service: jest.Mocked<Mem0Service>;

  beforeEach(async () => {
    const lists = new Map<string, string[]>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: RedisService,
          useValue: {
            lpush: jest.fn().mockImplementation((key: string, value: string) => {
              lists.set(key, [value, ...(lists.get(key) || [])]);
            }),
            lrange: jest
              .fn()
              .mockImplementation((key: string, start: number, end: number) =>
                (lists.get(key) || []).slice(start, end + 1),
              ),
            ltrim: jest.fn().mockImplementation((key: string, start: number, end: number) => {
              lists.set(key, (lists.get(key) || []).slice(start, end + 1));
            }),
            expire: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockImplementation((key: string) => {
              lists.delete(key);
            }),
          },
        },
        {
          provide: Mem0Service,
          useValue: {
            addMemory: jest.fn().mockResolvedValue(undefined),
            searchMemories: jest.fn().mockResolvedValue([]),
            getMemories: jest.fn().mockResolvedValue([]),
            deleteMemories: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(MemoryService);
    redisService = module.get(RedisService);
    mem0Service = module.get(Mem0Service);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('short-term memory', () => {
    it('stores short-term memory only in Redis with its retention limits', async () => {
      await service.saveShortTermMemory('conv-1', 'test content');

      expect(redisService.lpush).toHaveBeenCalledWith('memory:short:conv-1', expect.any(String));
      expect(redisService.ltrim).toHaveBeenCalledWith('memory:short:conv-1', 0, 49);
      expect(redisService.expire).toHaveBeenCalledWith('memory:short:conv-1', 3600);
      expect(mem0Service.addMemory).not.toHaveBeenCalled();
    });

    it('returns valid Redis entries and ignores damaged JSON', async () => {
      const memory = { id: '1', content: 'test', metadata: {}, createdAt: 123 };
      redisService.lrange.mockResolvedValue([JSON.stringify(memory), 'invalid json']);

      await expect(service.getShortTermMemory('conv-1')).resolves.toEqual([memory]);
      expect(redisService.lrange).toHaveBeenCalledWith('memory:short:conv-1', 0, 49);
    });

    it('clears only the conversation Redis key', async () => {
      await service.clearShortTermMemory('conv-1');

      expect(redisService.del).toHaveBeenCalledWith('memory:short:conv-1');
      expect(mem0Service.deleteMemories).not.toHaveBeenCalled();
    });
  });

  describe('long-term memory', () => {
    it('writes a user and assistant message pair to Mem0 without touching Redis', async () => {
      const messages = [
        { role: 'user' as const, content: '我喜欢科幻电影' },
        { role: 'assistant' as const, content: '以后会优先推荐科幻电影' },
      ];

      await service.saveLongTermMemory('user-1', messages, { conversationId: 'conv-1' });

      expect(mem0Service.addMemory).toHaveBeenCalledWith('user-1', messages, { conversationId: 'conv-1' });
      expect(redisService.lpush).not.toHaveBeenCalled();
      expect(redisService.ltrim).not.toHaveBeenCalled();
    });

    it('maps Mem0 records to MemoryItem', async () => {
      mem0Service.getMemories.mockResolvedValue([
        { id: 'mem-1', memory: '用户喜欢科幻电影', metadata: { source: 'chat' }, createdAt: 456 },
      ]);

      await expect(service.getLongTermMemory('user-1')).resolves.toEqual([
        { id: 'mem-1', content: '用户喜欢科幻电影', metadata: { source: 'chat' }, createdAt: 456 },
      ]);
      expect(mem0Service.getMemories).toHaveBeenCalledWith('user-1', 10);
      expect(redisService.lrange).not.toHaveBeenCalled();
    });

    it('clears Mem0 memories without deleting legacy Redis keys', async () => {
      await service.clearLongTermMemory('user-1');

      expect(mem0Service.deleteMemories).toHaveBeenCalledWith('user-1');
      expect(redisService.del).not.toHaveBeenCalled();
    });
  });

  describe('getRelevantMemories', () => {
    it('combines ranked short-term records with Mem0 semantic results and removes duplicates', async () => {
      redisService.lrange.mockResolvedValue([
        JSON.stringify({ id: 'short-new', content: '普通新消息', metadata: {}, createdAt: 300 }),
        JSON.stringify({ id: 'short-match', content: '我喜欢 科幻', metadata: {}, createdAt: 200 }),
      ]);
      mem0Service.searchMemories.mockResolvedValue([
        { id: 'long-duplicate', memory: '  我喜欢   科幻 ', metadata: {}, createdAt: 100 },
        { id: 'long-unique', memory: '用户不喜欢恐怖片', metadata: {}, createdAt: 90 },
      ]);

      const result = await service.getRelevantMemories('科幻', 'conv-1', 'user-1');

      expect(result.map((memory) => memory.id)).toEqual(['short-match', 'short-new', 'long-unique']);
      expect(mem0Service.searchMemories).toHaveBeenCalledWith('科幻', 'user-1', 10);
      expect(mem0Service.getMemories).not.toHaveBeenCalled();
    });

    it('uses the latest Mem0 memories when the query is empty', async () => {
      await service.getRelevantMemories('   ', 'conv-1', 'user-1');

      expect(mem0Service.getMemories).toHaveBeenCalledWith('user-1', 10);
      expect(mem0Service.searchMemories).not.toHaveBeenCalled();
    });

    it('propagates Mem0 failures instead of degrading to Redis-only results', async () => {
      mem0Service.searchMemories.mockRejectedValue(new Error('Mem0 unavailable'));

      await expect(service.getRelevantMemories('test', 'conv-1', 'user-1')).rejects.toThrow('Mem0 unavailable');
    });

    it('limits each memory source to ten records and the merged result to twenty', async () => {
      redisService.lrange.mockResolvedValue(
        Array.from({ length: 15 }, (_, index) =>
          JSON.stringify({ id: `short-${index}`, content: `short ${index}`, metadata: {}, createdAt: 100 - index }),
        ),
      );
      mem0Service.searchMemories.mockResolvedValue(
        Array.from({ length: 10 }, (_, index) => ({
          id: `long-${index}`,
          memory: `long ${index}`,
          metadata: {},
          createdAt: 50 - index,
        })),
      );

      const result = await service.getRelevantMemories('memory', 'conv-1', 'user-1');

      expect(result).toHaveLength(20);
      expect(result.filter((memory) => memory.id.startsWith('short-'))).toHaveLength(10);
      expect(result.filter((memory) => memory.id.startsWith('long-'))).toHaveLength(10);
    });
  });
});
