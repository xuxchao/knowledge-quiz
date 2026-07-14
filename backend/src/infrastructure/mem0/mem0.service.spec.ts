import { ConfigService } from '@nestjs/config';
import { Mem0RequestError, Mem0Service } from './mem0.service';

describe('Mem0Service', () => {
  let service: Mem0Service;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    service = createService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('writes paired messages with the user id, metadata and API key', async () => {
    fetchMock.mockResolvedValue(response(200, { results: [] }));
    const messages = [
      { role: 'user' as const, content: '我喜欢科幻电影' },
      { role: 'assistant' as const, content: '我会记住' },
    ];

    await service.addMemory('user-1', messages, { conversationId: 'conv-1' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://mem0.test/memories');
    expect(init.headers).toEqual(expect.objectContaining({ 'X-API-Key': 'test-api-key' }));
    expect(JSON.parse(String(init.body))).toEqual({
      messages,
      user_id: 'user-1',
      metadata: { conversationId: 'conv-1' },
    });
  });

  it('searches with an isolated user filter and maps Mem0 records', async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        results: [
          {
            id: 'mem-1',
            memory: '用户喜欢科幻电影',
            metadata: { source: 'chat' },
            created_at: '2026-07-14T01:02:03.000Z',
            score: 0.9,
          },
        ],
      }),
    );

    const result = await service.searchMemories('喜欢什么电影', 'user-1', 10);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      query: '喜欢什么电影',
      filters: { user_id: 'user-1' },
      top_k: 10,
    });
    expect(result).toEqual([
      {
        id: 'mem-1',
        memory: '用户喜欢科幻电影',
        metadata: { source: 'chat' },
        createdAt: Date.parse('2026-07-14T01:02:03.000Z'),
      },
    ]);
  });

  it('gets the latest memories for empty-query callers', async () => {
    fetchMock.mockResolvedValue(response(200, { results: [] }));

    await service.getMemories('user with spaces', 5);

    expect(fetchMock.mock.calls[0][0]).toBe('http://mem0.test/memories?user_id=user+with+spaces&top_k=5');
  });

  it('deletes only the requested user memories', async () => {
    fetchMock.mockResolvedValue(response(200, { message: 'deleted' }));

    await service.deleteMemories('user-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://mem0.test/memories?user_id=user-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('rejects authentication failures with the Mem0 status', async () => {
    fetchMock.mockResolvedValue(response(401, { detail: 'Unauthorized' }));

    await expect(service.getMemories('user-1')).rejects.toThrow('Mem0请求失败，状态码: 401');
  });

  it('rejects invalid JSON responses', async () => {
    fetchMock.mockResolvedValue(responseText(200, 'not-json'));

    await expect(service.getMemories('user-1')).rejects.toThrow('Mem0返回了无效JSON');
  });

  it('rejects invalid response structures', async () => {
    fetchMock.mockResolvedValue(response(200, { memories: [] }));

    await expect(service.getMemories('user-1')).rejects.toThrow('Mem0返回的数据结构无效');
  });

  it('rejects invalid memory entries', async () => {
    fetchMock.mockResolvedValue(response(200, { results: [{ id: 'mem-1' }] }));

    await expect(service.searchMemories('query', 'user-1')).rejects.toThrow('Mem0返回的记忆条目无效');
  });

  it('wraps network errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('connection refused'));

    await expect(service.searchMemories('query', 'user-1')).rejects.toThrow('无法连接Mem0服务');
  });

  it('aborts requests after the configured timeout', async () => {
    jest.useFakeTimers();
    service = createService({ MEM0_TIMEOUT_MS: '5' });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    const request = service.searchMemories('query', 'user-1');
    const expectation = expect(request).rejects.toThrow('Mem0请求超时（5ms）');
    await jest.advanceTimersByTimeAsync(6);

    await expectation;
  });

  function createService(overrides: Record<string, string> = {}): Mem0Service {
    const values: Record<string, string> = {
      MEM0_BASE_URL: 'http://mem0.test/',
      MEM0_API_KEY: 'test-api-key',
      MEM0_TIMEOUT_MS: '30000',
      ...overrides,
    };
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => values[key] ?? defaultValue),
    } as unknown as ConfigService;
    return new Mem0Service(configService);
  }

  function response(status: number, body: unknown): Response {
    return responseText(status, JSON.stringify(body));
  }

  function responseText(status: number, body: string): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }
});
