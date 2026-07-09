import { LogServiceCall } from './decorators';

describe('logger decorators', () => {
  class StreamService {
    @LogServiceCall()
    async *streamValues(): AsyncGenerator<string> {
      yield await Promise.resolve('hello');
      yield ' world';
    }
  }

  it('keeps async generator methods consumable as async iterables', async () => {
    const result = new StreamService().streamValues();
    const chunks: string[] = [];

    expect(result[Symbol.asyncIterator]).toEqual(expect.any(Function));

    for await (const chunk of result) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('hello world');
  });
});
