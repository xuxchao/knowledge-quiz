import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MemoryService } from './memory.service';
import { RedisService } from '../infrastructure/redis/redis.service';

describe('MemoryService', () => {
  let service: MemoryService;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      providers: [
        MemoryService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(),
            del: jest.fn().mockResolvedValue(),
          },
        },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('saveShortTermMemory', () => {
    it('should save memory successfully', async () => {
      await expect(
        service.saveShortTermMemory('conv-1', 'test content'),
      ).resolves.not.toThrow();
    });
  });

  describe('getShortTermMemory', () => {
    it('should return empty array if no memory', async () => {
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      const result = await service.getShortTermMemory('non-existent');
      expect(result).toEqual([]);
    });

    it('should return memories if they exist', async () => {
      const mockMemories = [
        { id: '1', content: 'test', metadata: {}, createdAt: Date.now() },
      ];
      jest
        .spyOn(redisService, 'get')
        .mockResolvedValue(JSON.stringify(mockMemories));
      const result = await service.getShortTermMemory('conv-1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('saveLongTermMemory', () => {
    it('should save memory successfully', () => {
      expect(() =>
        service.saveLongTermMemory('user-1', 'test content'),
      ).not.toThrow();
    });
  });

  describe('getLongTermMemory', () => {
    it('should return empty array if no memory', () => {
      const result = service.getLongTermMemory('non-existent');
      expect(result).toEqual([]);
    });

    it('should return memories if they exist', () => {
      service.saveLongTermMemory('user-1', 'test content');
      const result = service.getLongTermMemory('user-1');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getRelevantMemories', () => {
    it('should return relevant memories', async () => {
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      const result = await service.getRelevantMemories(
        'test',
        'conv-1',
        'user-1',
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('clearShortTermMemory', () => {
    it('should clear memory successfully', async () => {
      jest.spyOn(redisService, 'del').mockResolvedValue();
      await expect(
        service.clearShortTermMemory('conv-1'),
      ).resolves.not.toThrow();
    });
  });

  describe('clearLongTermMemory', () => {
    it('should clear memory successfully', () => {
      service.saveLongTermMemory('user-1', 'test content');
      expect(() => service.clearLongTermMemory('user-1')).not.toThrow();
    });
  });
});
