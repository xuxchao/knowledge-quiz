import { Neo4jService } from './neo4j.service';

describe('Neo4jService novel graph', () => {
  it('should replace only the requested document graph in one write transaction', async () => {
    const transaction = {
      run: jest
        .fn()
        .mockImplementation((query: string) =>
          Promise.resolve(
            query.includes('RETURN count(relation) AS count')
              ? { records: [{ get: jest.fn().mockReturnValue(1) }] }
              : { records: [] },
          ),
        ),
    };
    const session = {
      executeWrite: jest.fn().mockImplementation((callback) => callback(transaction)),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const service = new Neo4jService({ get: jest.fn() } as never);
    (service as unknown as { driver: { session(): unknown } }).driver = { session: () => session };

    await service.replaceNovelGraph({
      novel: { id: 'doc-1:novel', documentId: 'doc-1', title: '测试小说' },
      chapters: [{ id: 'chapter-1', documentId: 'doc-1', ordinal: 1, title: '第一章', evidenceChunkIds: ['c1'] }],
      entities: [
        {
          id: 'character-1',
          documentId: 'doc-1',
          type: 'Character',
          name: '甲',
          normalizedName: '甲',
          aliases: [],
          evidenceChunkIds: ['c1'],
        },
      ],
      relations: [
        {
          id: 'relation-1',
          documentId: 'doc-1',
          sourceId: 'doc-1:novel',
          targetId: 'chapter-1',
          type: '包含章节',
          confidence: 1,
          evidenceChunkIds: ['c1'],
        },
      ],
      version: '1',
    });

    expect(transaction.run).toHaveBeenNthCalledWith(1, expect.stringContaining('DETACH DELETE'), {
      documentId: 'doc-1',
    });
    expect(transaction.run).toHaveBeenCalledWith(
      expect.stringContaining('CREATE (source)-[r:`包含章节`]'),
      expect.anything(),
    );
    expect(session.close).toHaveBeenCalled();
  });

  it('should roll back a graph that contains no relationships', async () => {
    const transaction = { run: jest.fn().mockResolvedValue({ records: [{ get: jest.fn().mockReturnValue(0) }] }) };
    const session = {
      executeWrite: jest.fn().mockImplementation((callback) => callback(transaction)),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const service = new Neo4jService({ get: jest.fn() } as never);
    (service as unknown as { driver: { session(): unknown } }).driver = { session: () => session };

    await expect(
      service.replaceNovelGraph({
        novel: { id: 'doc-1:novel', documentId: 'doc-1', title: '测试小说' },
        chapters: [],
        entities: [],
        relations: [],
        version: '1',
      }),
    ).rejects.toThrow('文档图谱没有任何关联关系');
    expect(session.close).toHaveBeenCalled();
  });

  it('should roll back a graph that contains isolated nodes', async () => {
    const transaction = {
      run: jest.fn().mockImplementation((query: string) =>
        Promise.resolve({
          records: [{ get: jest.fn().mockReturnValue(query.includes('WHERE NOT (node)--()') ? 1 : 2) }],
        }),
      ),
    };
    const session = {
      executeWrite: jest.fn().mockImplementation((callback) => callback(transaction)),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const service = new Neo4jService({ get: jest.fn() } as never);
    (service as unknown as { driver: { session(): unknown } }).driver = { session: () => session };

    await expect(
      service.replaceNovelGraph({
        novel: { id: 'doc-1:novel', documentId: 'doc-1', title: '测试小说' },
        chapters: [{ id: 'chapter-1', documentId: 'doc-1', ordinal: 1, title: '第一章', evidenceChunkIds: ['c1'] }],
        entities: [],
        relations: [
          {
            id: 'relation-1',
            documentId: 'doc-1',
            sourceId: 'doc-1:novel',
            targetId: 'chapter-1',
            type: '包含章节',
            confidence: 1,
            evidenceChunkIds: ['c1'],
          },
        ],
        version: '1',
      }),
    ).rejects.toThrow('存在1个孤立节点');
    expect(session.close).toHaveBeenCalled();
  });

  it('should reconstruct graph evidence with source chunk ids', async () => {
    const session = {
      run: jest.fn().mockResolvedValue({
        records: [
          {
            get: jest.fn(
              (key: string) =>
                ({
                  source: { documentId: 'doc-1', name: '甲' },
                  target: { documentId: 'doc-1', name: '乙' },
                  relation: { kind: '盟友', confidence: 0.9, evidenceChunkIds: ['c1'], description: '结盟' },
                  relationType: '相关',
                  documentName: '测试小说',
                })[key],
            ),
          },
        ],
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const service = new Neo4jService({ get: jest.fn() } as never);
    (service as unknown as { driver: { session(): unknown } }).driver = { session: () => session };

    const result = await service.searchGraph(
      { mode: 'graph', entities: ['甲'], relationshipKinds: ['盟友'] },
      ['doc-1'],
      5,
    );

    expect(result).toEqual([
      {
        documentId: 'doc-1',
        documentName: '测试小说',
        statement: '甲 -[盟友]-> 乙：结盟',
        evidenceChunkIds: ['c1'],
        confidence: 0.9,
      },
    ]);
    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (source)-[relation]->(target)'),
      expect.objectContaining({
        documentIds: ['doc-1'],
        entities: ['甲'],
        relationshipKinds: ['盟友'],
      }),
    );
  });
});
