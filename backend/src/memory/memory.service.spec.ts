import { MemoryService } from './memory.service';
import { Mem0Service } from '../infrastructure/mem0/mem0.service';
import { ConfigService } from '@nestjs/config';

describe('MemoryService', () => {
  let service: MemoryService;
  let mem0Service: jest.Mocked<Mem0Service>;

  beforeEach(() => {
    mem0Service = {
      addMemory: jest.fn().mockResolvedValue(undefined),
      searchMemories: jest.fn().mockResolvedValue([]),
      searchConversationMemories: jest.fn().mockResolvedValue([]),
      deleteConversationMemories: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Mem0Service>;
    service = new MemoryService(mem0Service, {
      get: jest.fn((key: string, defaultValue?: string) => key === 'MEM0_ENABLED' ? 'true' : defaultValue),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('combines user and conversation memories while removing duplicates', async () => {
    mem0Service.searchMemories.mockResolvedValue([
      { id: 'user-1', memory: '用户喜欢科幻', metadata: {}, createdAt: 2 },
    ]);
    mem0Service.searchConversationMemories.mockResolvedValue([
      { id: 'conv-duplicate', memory: ' 用户喜欢科幻 ', metadata: {}, createdAt: 1 },
      { id: 'conv-1', memory: '正在讨论检索方案', metadata: {}, createdAt: 3 },
    ]);

    const result = await service.getRelevantMemories('方案', 'conversation-1', 'user-1');

    expect(result.map((item) => item.id)).toEqual(['user-1', 'conv-1']);
    expect(mem0Service.searchMemories).toHaveBeenCalledWith('方案', 'user-1', 10);
    expect(mem0Service.searchConversationMemories).toHaveBeenCalledWith('方案', 'conversation-1', 10);
  });

  it('propagates Mem0 query failures before answering', async () => {
    mem0Service.searchMemories.mockRejectedValue(new Error('Mem0 unavailable'));

    await expect(service.getRelevantMemories('问题', 'conversation-1', 'user-1')).rejects.toThrow('Mem0 unavailable');
  });

  it('stores user and conversation memories in isolated scopes', async () => {
    const messages = [
      { role: 'user' as const, content: '我喜欢科幻' },
      { role: 'assistant' as const, content: '已记录' },
    ];

    await service.saveUserMemory('user-1', 'conversation-1', messages);
    await service.saveConversationMemory('conversation-1', 'user-1', messages);

    expect(mem0Service.addMemory).toHaveBeenNthCalledWith(
      1,
      { userId: 'user-1' },
      messages,
      expect.objectContaining({ memoryScope: 'user' }),
      expect.any(String),
    );
    expect(mem0Service.addMemory).toHaveBeenNthCalledWith(
      2,
      { runId: 'conversation-1' },
      messages,
      expect.objectContaining({ memoryScope: 'conversation' }),
      expect.any(String),
    );
  });

  it('retries three times and ignores the final save failure', async () => {
    jest.useFakeTimers();
    mem0Service.addMemory.mockRejectedValue(new Error('offline'));

    const saving = service.saveUserMemory('user-1', 'conversation-1', [{ role: 'user', content: '内容' }]);
    await jest.runAllTimersAsync();
    await expect(saving).resolves.toBeUndefined();

    expect(mem0Service.addMemory).toHaveBeenCalledTimes(4);
  });

  describe('when MEM0_ENABLED=false', () => {
    let disabledService: MemoryService;

    beforeEach(() => {
      disabledService = new MemoryService(mem0Service, {
        get: jest.fn((key: string, defaultValue?: string) => key === 'MEM0_ENABLED' ? 'false' : defaultValue),
      } as unknown as ConfigService);
    });

    it('getRelevantMemories returns empty array without calling mem0', async () => {
      const result = await disabledService.getRelevantMemories('问题', 'conv-1', 'user-1');
      expect(result).toEqual([]);
      expect(mem0Service.searchMemories).not.toHaveBeenCalled();
      expect(mem0Service.searchConversationMemories).not.toHaveBeenCalled();
    });

    it('saveUserMemory skips without calling mem0', async () => {
      await disabledService.saveUserMemory('user-1', 'conv-1', [{ role: 'user', content: '内容' }]);
      expect(mem0Service.addMemory).not.toHaveBeenCalled();
    });

    it('saveConversationMemory skips without calling mem0', async () => {
      await disabledService.saveConversationMemory('conv-1', 'user-1', [{ role: 'user', content: '内容' }]);
      expect(mem0Service.addMemory).not.toHaveBeenCalled();
    });

    it('deleteConversationMemory skips without calling mem0', async () => {
      await disabledService.deleteConversationMemory('conv-1');
      expect(mem0Service.deleteConversationMemories).not.toHaveBeenCalled();
    });
  });
});
