import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { RedisService } from './redis.service';

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('MemoryService', () => {
  let service: MemoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('saveShortTermMemory and getShortTermMemory', () => {
    it('should save and retrieve memory with createdAt as number', async () => {
      const conversationId = 'test-conversation';
      const content = 'test content';

      await service.saveShortTermMemory(conversationId, content);

      expect(mockRedisService.set).toHaveBeenCalled();
      const savedValue = JSON.parse(mockRedisService.set.mock.calls[0][1]);
      expect(savedValue.length).toBe(1);
      expect(savedValue[0].content).toBe(content);
      expect(typeof savedValue[0].createdAt).toBe('number');

      mockRedisService.get.mockResolvedValue(mockRedisService.set.mock.calls[0][1]);
      const memories = await service.getShortTermMemory(conversationId);

      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe(content);
      expect(typeof memories[0].createdAt).toBe('number');
    });

    it('should handle old format data with createdAt as string', async () => {
      const conversationId = 'test-old-format';
      const oldFormatData = JSON.stringify([
        {
          id: 'old-id',
          content: 'old content',
          metadata: {},
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ]);

      mockRedisService.get.mockResolvedValue(oldFormatData);

      const memories = await service.getShortTermMemory(conversationId);

      expect(memories.length).toBe(1);
      expect(typeof memories[0].createdAt).toBe('number');
      expect(memories[0].createdAt).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
    });

    it('should handle mixed format data (both string and number createdAt)', async () => {
      const conversationId = 'test-mixed-format';
      const mixedFormatData = JSON.stringify([
        {
          id: 'old-id',
          content: 'old content',
          metadata: {},
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'new-id',
          content: 'new content',
          metadata: {},
          createdAt: 1704067200000,
        },
      ]);

      mockRedisService.get.mockResolvedValue(mixedFormatData);

      const memories = await service.getShortTermMemory(conversationId);

      expect(memories.length).toBe(2);
      expect(typeof memories[0].createdAt).toBe('number');
      expect(typeof memories[1].createdAt).toBe('number');
    });
  });

  describe('saveLongTermMemory and getLongTermMemory', () => {
    it('should save and retrieve long term memory with createdAt as number', () => {
      const userId = 'test-user';
      const content = 'test long term content';

      service.saveLongTermMemory(userId, content);
      const memories = service.getLongTermMemory(userId);

      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe(content);
      expect(typeof memories[0].createdAt).toBe('number');
    });
  });

  describe('getRelevantMemories', () => {
    it('should sort memories by createdAt in descending order', async () => {
      const conversationId = 'test-sort';
      const userId = 'test-user';

      const earlierTime = Date.now() - 10000;
      const laterTime = Date.now();

      const shortTermData = JSON.stringify([
        {
          id: 'short-1',
          content: 'short content 1',
          metadata: {},
          createdAt: earlierTime,
        },
        {
          id: 'short-2',
          content: 'short content 2',
          metadata: {},
          createdAt: laterTime,
        },
      ]);

      mockRedisService.get.mockResolvedValue(shortTermData);

      service.saveLongTermMemory(userId, 'long term content');

      const memories = await service.getRelevantMemories('query', conversationId, userId);

      expect(memories.length).toBe(3);
      expect(memories[0].createdAt).toBeGreaterThanOrEqual(memories[1].createdAt);
      expect(memories[1].createdAt).toBeGreaterThanOrEqual(memories[2].createdAt);
    });

    it('should handle old format data in sorting', async () => {
      const conversationId = 'test-sort-old-format';
      const userId = 'test-user';

      const oldFormatData = JSON.stringify([
        {
          id: 'old-1',
          content: 'old content',
          metadata: {},
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'new-1',
          content: 'new content',
          metadata: {},
          createdAt: Date.now(),
        },
      ]);

      mockRedisService.get.mockResolvedValue(oldFormatData);

      const memories = await service.getRelevantMemories('query', conversationId, userId);

      expect(memories.length).toBe(2);
      expect(memories[0].createdAt).toBeGreaterThan(memories[1].createdAt);
    });
  });

  describe('clearShortTermMemory and clearLongTermMemory', () => {
    it('should clear short term memory', async () => {
      const conversationId = 'test-clear';

      await service.clearShortTermMemory(conversationId);

      expect(mockRedisService.del).toHaveBeenCalledWith(`memory:short:${conversationId}`);
    });

    it('should clear long term memory', () => {
      const userId = 'test-clear-long';

      service.saveLongTermMemory(userId, 'content');
      service.clearLongTermMemory(userId);

      const memories = service.getLongTermMemory(userId);

      expect(memories.length).toBe(0);
    });
  });
});