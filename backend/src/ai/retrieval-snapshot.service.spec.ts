import { mkdir, writeFile } from 'node:fs/promises';
import { RetrievalSnapshotInput, RetrievalSnapshotService } from './retrieval-snapshot.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

const mockedMkdir = jest.mocked(mkdir);
const mockedWriteFile = jest.mocked(writeFile);

describe('RetrievalSnapshotService', () => {
  const input: RetrievalSnapshotInput = {
    conversationId: 'conversation-1',
    startedAt: new Date('2026-07-17T08:00:00.000Z'),
    query: ' 原始查询 ',
    normalizedQuery: '原始查询',
    documentIds: ['document-1'],
    queryPlan: { mode: 'hybrid', entities: ['角色'], relationshipKinds: [] },
    errors: [],
    stages: {
      postgresVector: [{ content: '向量正文', metadata: { chunkId: 'chunk-1' }, score: 0.9 }],
      elasticsearch: [
        {
          chunkId: 'chunk-1',
          documentId: 'document-1',
          documentName: '文档',
          content: '关键词正文',
          chunkIndex: 0,
          score: 8,
          metadata: {},
        },
      ],
      neo4j: [
        {
          documentId: 'document-1',
          documentName: '文档',
          statement: '角色关系',
          evidenceChunkIds: ['chunk-2'],
          confidence: 0.8,
        },
      ],
      fused: [],
      reranked: [],
      selectAndExpand: [],
      final: [],
    },
  };

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should not access the file system when snapshots are disabled', async () => {
    const service = new RetrievalSnapshotService({ get: jest.fn().mockReturnValue('false') } as never);

    await service.write(input);

    expect(mockedMkdir).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });

  it('should write a complete snapshot to a unique JSON file', async () => {
    const service = new RetrievalSnapshotService({ get: jest.fn().mockReturnValue('true') } as never);

    await service.write(input);
    await service.write(input);

    expect(mockedMkdir).toHaveBeenCalledTimes(2);
    expect(mockedWriteFile).toHaveBeenCalledTimes(2);
    const firstCall = mockedWriteFile.mock.calls[0];
    const secondCall = mockedWriteFile.mock.calls[1];
    expect(firstCall[0]).not.toEqual(secondCall[0]);
    expect(String(firstCall[0])).toMatch(/conversation-1_[0-9a-f-]+\.json$/);

    const snapshot = JSON.parse(String(firstCall[1])) as Record<string, any>;
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      conversationId: 'conversation-1',
      query: ' 原始查询 ',
      normalizedQuery: '原始查询',
      documentIds: ['document-1'],
      counts: { postgresVector: 1, elasticsearch: 1, neo4j: 1 },
    });
    expect(snapshot.stages.initial.postgresVector[0].content).toBe('向量正文');
    expect(snapshot.stages.initial.elasticsearch[0].content).toBe('关键词正文');
    expect(snapshot.stages.initial.neo4j[0].statement).toBe('角色关系');
    expect(snapshot).not.toHaveProperty('embedding');
  });

  it('should swallow file system errors so retrieval can continue', async () => {
    const service = new RetrievalSnapshotService({ get: jest.fn().mockReturnValue('true') } as never);
    mockedMkdir.mockRejectedValueOnce(new Error('permission denied'));

    await expect(service.write(input)).resolves.toBeUndefined();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });
});
