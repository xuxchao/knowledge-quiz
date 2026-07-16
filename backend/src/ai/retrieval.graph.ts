import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { SearchChunk } from '../infrastructure/elasticsearch/elasticsearch.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { RetrievedChunk, RetrievalService, VectorSearchHit } from './retrieval.service';

const RetrievalState = Annotation.Root({
  query: Annotation<string>(),
  documentIds: Annotation<string[] | undefined>(),
  normalizedQuery: Annotation<string>(),
  embedding: Annotation<number[]>(),
  vectorHits: Annotation<VectorSearchHit[]>({ reducer: (_left, right) => right, default: () => [] }),
  keywordHits: Annotation<SearchChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  errors: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] }),
  fused: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  reranked: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  selected: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
});

type RetrievalGraphState = typeof RetrievalState.State;

@Injectable()
export class RetrievalGraph {
  private readonly logger = new LoggerService(RetrievalGraph.name);

  constructor(private readonly retrievalService: RetrievalService) {}

  @LogServiceCall()
  async retrieve(query: string, documentIds?: string[]): Promise<RetrievedChunk[]> {
    const graph = this.build().compile();
    const result = await graph.invoke(
      { query, documentIds },
      { runName: 'rag.retrieval', tags: ['rag', 'retrieval', 'langgraph'] },
    );
    return result.selected;
  }

  private build() {
    return new StateGraph(RetrievalState)
      .addNode('normalizeQuery', (state) => ({ normalizedQuery: this.retrievalService.normalizeQuery(state.query) }))
      .addNode('embedQuery', async (state) => ({
        embedding: await this.retrievalService.embedQuery(state.normalizedQuery),
      }))
      .addNode('vectorSearch', (state) => this.vectorSearch(state))
      .addNode('keywordSearch', (state) => this.keywordSearch(state))
      .addNode('fuse', (state) => this.fuse(state))
      .addNode('rerank', async (state) => ({
        reranked: await this.retrievalService.rerank(state.normalizedQuery, state.fused.slice(0, 30)),
      }))
      .addNode('selectAndExpand', async (state) => ({
        selected: await this.retrievalService.selectAndExpand(state.reranked),
      }))
      .addEdge(START, 'normalizeQuery')
      .addEdge('normalizeQuery', 'embedQuery')
      .addEdge('embedQuery', 'vectorSearch')
      .addEdge('embedQuery', 'keywordSearch')
      .addEdge(['vectorSearch', 'keywordSearch'], 'fuse')
      .addEdge('fuse', 'rerank')
      .addEdge('rerank', 'selectAndExpand')
      .addEdge('selectAndExpand', END);
  }

  private async vectorSearch(state: RetrievalGraphState): Promise<Partial<RetrievalGraphState>> {
    try {
      return { vectorHits: await this.retrievalService.searchVector(state.embedding, state.documentIds) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`向量检索失败，尝试使用关键词结果 - 错误: ${message}`);
      return { vectorHits: [], errors: [`vector:${message}`] };
    }
  }

  private async keywordSearch(state: RetrievalGraphState): Promise<Partial<RetrievalGraphState>> {
    try {
      return { keywordHits: await this.retrievalService.searchKeyword(state.normalizedQuery, state.documentIds) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`关键词检索失败，尝试使用向量结果 - 错误: ${message}`);
      return { keywordHits: [], errors: [`keyword:${message}`] };
    }
  }

  private fuse(state: RetrievalGraphState): Partial<RetrievalGraphState> {
    if (state.errors.length >= 2 && !state.vectorHits.length && !state.keywordHits.length) {
      throw new Error('知识库检索服务暂时不可用');
    }
    return { fused: this.retrievalService.fuse(state.vectorHits, state.keywordHits) };
  }
}
