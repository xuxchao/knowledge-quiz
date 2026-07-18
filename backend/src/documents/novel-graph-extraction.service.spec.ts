import { NovelGraphStatus } from '../entities/document.entity';
import { NovelGraphExtractionService } from './novel-graph-extraction.service';

describe('NovelGraphExtractionService', () => {
  it('should keep chapter-aware, evidenced relationships without isolated entity nodes', async () => {
    const documentRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'doc-1', name: '测试小说' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const chunks = [
      {
        id: 'c1',
        documentId: 'doc-1',
        content: '甲遇见乙。',
        chunkIndex: 0,
        tokenCount: 10,
        metadata: { chapterOrdinal: 1, chapterTitle: '第一章' },
      },
      {
        id: 'c2',
        documentId: 'doc-1',
        content: '甲与乙结盟。',
        chunkIndex: 1,
        tokenCount: 10,
        metadata: { chapterOrdinal: 2, chapterTitle: '第二章' },
      },
    ];
    const chunkRepository = { find: jest.fn().mockResolvedValue(chunks) };
    const aiService = {
      generateStructuredJson: jest.fn().mockImplementation((_system: string, user: string, runName: string) => {
        if (runName.includes('canonicalize')) return Promise.resolve({ groups: [] });
        const chunkId = user.includes('[c1]') ? 'c1' : 'c2';
        return Promise.resolve({
          entities: [
            { type: '角色', name: '甲', evidenceChunkIds: [chunkId] },
            { type: '角色', name: '乙', evidenceChunkIds: [chunkId] },
            { type: '地点', name: '长安', evidenceChunkIds: [chunkId] },
          ],
          relations:
            chunkId === 'c2'
              ? [
                  {
                    source: '甲',
                    target: '乙',
                    type: '相关',
                    kind: '盟友',
                    description: '二人结盟',
                    confidence: 0.95,
                    evidenceChunkIds: ['c2'],
                  },
                  {
                    source: '甲',
                    target: '乙',
                    type: '相关',
                    kind: '敌对',
                    confidence: 0.2,
                    evidenceChunkIds: ['c2'],
                  },
                ]
              : [],
        });
      }),
    };
    const neo4jService = { replaceNovelGraph: jest.fn().mockResolvedValue(undefined) };
    const service = new NovelGraphExtractionService(
      documentRepository as never,
      chunkRepository as never,
      aiService as never,
      neo4jService as never,
      { get: jest.fn((_key: string, fallback: string) => fallback) } as never,
    );

    const payload = await service.extractAndStore('doc-1');

    expect(payload.chapters.map((chapter) => chapter.ordinal)).toEqual([1, 2]);
    expect(payload.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: '下一章', chapterOrdinal: 2 }),
        expect.objectContaining({ type: '提及于', chapterOrdinal: 1 }),
        expect.objectContaining({ type: '相关', kind: '盟友', chapterOrdinal: 2, evidenceChunkIds: ['c2'] }),
      ]),
    );
    expect(payload.relations).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: '敌对' })]));
    expect(neo4jService.replaceNovelGraph).toHaveBeenCalledWith(payload);
    expect(documentRepository.update).toHaveBeenLastCalledWith(
      'doc-1',
      expect.objectContaining({
        graphStatus: NovelGraphStatus.READY,
      }),
    );
  });
});
