import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { SearchChunk } from '../infrastructure/elasticsearch/elasticsearch.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { RetrievedChunk, RetrievalService, VectorSearchHit } from './retrieval.service';
import { GraphEvidence, NovelQueryPlan } from '../infrastructure/neo4j/novel-graph.types';
import { RetrievalSnapshotService } from './retrieval-snapshot.service';
import type { ChatTraceContext } from '../infrastructure/langfuse/langfuse.service';

export interface HybridRetrievalResult {
  chunks: RetrievedChunk[];
  graphEvidence: GraphEvidence[];
}

export interface RetrievalDebugContext {
  conversationId?: string;
  userId?: string;
}

const RetrievalState = Annotation.Root({
  query: Annotation<string>(),
  documentIds: Annotation<string[] | undefined>(),
  traceContext: Annotation<ChatTraceContext | undefined>(),
  normalizedQuery: Annotation<string>(),
  queryPlan: Annotation<NovelQueryPlan>(),
  embedding: Annotation<number[]>(),
  vectorHits: Annotation<VectorSearchHit[]>({ reducer: (_left, right) => right, default: () => [] }),
  keywordHits: Annotation<SearchChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  graphEvidence: Annotation<GraphEvidence[]>({ reducer: (_left, right) => right, default: () => [] }),
  errors: Annotation<string[]>({ reducer: (left, right) => [...left, ...right], default: () => [] }),
  fused: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  reranked: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  selectedAndExpanded: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
  selected: Annotation<RetrievedChunk[]>({ reducer: (_left, right) => right, default: () => [] }),
});

type RetrievalGraphState = typeof RetrievalState.State;

@Injectable()
export class RetrievalGraph {
  private readonly logger = new LoggerService(RetrievalGraph.name);

  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly retrievalSnapshotService: RetrievalSnapshotService,
  ) {}

  @LogServiceCall()
  async retrieve(
    query: string,
    documentIds?: string[],
    debugContext?: RetrievalDebugContext,
  ): Promise<HybridRetrievalResult> {
    const startedAt = new Date();
    const graph = this.build().compile();
    const result = await graph.invoke(
      {
        query,
        documentIds,
        traceContext:
          debugContext?.conversationId && debugContext.userId
            ? { conversationId: debugContext.conversationId, userId: debugContext.userId }
            : undefined,
      },
      { runName: 'rag.retrieval', tags: ['rag', 'retrieval', 'langgraph'] },
    );
    await this.retrievalSnapshotService.write({
      conversationId: debugContext?.conversationId,
      startedAt,
      query,
      normalizedQuery: result.normalizedQuery,
      documentIds,
      queryPlan: result.queryPlan,
      errors: result.errors,
      stages: {
        postgresVector: result.vectorHits,
        elasticsearch: result.keywordHits,
        neo4j: result.graphEvidence,
        fused: result.fused,
        reranked: result.reranked,
        selectAndExpand: result.selectedAndExpanded,
        final: result.selected,
      },
    });
    return { chunks: result.selected, graphEvidence: result.graphEvidence };
  }

  private build() {
    return new StateGraph(RetrievalState)
      .addNode('normalizeQuery', (state) => ({ normalizedQuery: this.retrievalService.normalizeQuery(state.query) }))
      .addNode('analyzeQuery', async (state) => ({
        queryPlan: await this.retrievalService.analyzeNovelQuery(state.normalizedQuery, state.traceContext),
      }))
      .addNode('embedQuery', async (state) => ({
        embedding: await this.retrievalService.embedQuery(state.normalizedQuery, state.traceContext),
      }))
      .addNode('vectorSearch', (state) => this.vectorSearch(state))
      .addNode('keywordSearch', (state) => this.keywordSearch(state))
      .addNode('graphSearch', (state) => this.graphSearch(state))
      .addNode('fuse', (state) => this.fuse(state))
      .addNode('rerank', async (state) => ({
        reranked: await this.retrievalService.rerank(
          state.normalizedQuery,
          state.fused.slice(0, 30),
          state.traceContext,
        ),
      }))
      .addNode('selectAndExpand', (state) => this.selectAndExpand(state))
      .addEdge(START, 'normalizeQuery')
      .addEdge('normalizeQuery', 'analyzeQuery')
      .addEdge('analyzeQuery', 'embedQuery')
      .addEdge('embedQuery', 'vectorSearch')
      .addEdge('embedQuery', 'keywordSearch')
      .addEdge('embedQuery', 'graphSearch')
      .addEdge(['vectorSearch', 'keywordSearch', 'graphSearch'], 'fuse')
      .addEdge('fuse', 'rerank')
      .addEdge('rerank', 'selectAndExpand')
      .addEdge('selectAndExpand', END);
  }

  private async vectorSearch(state: RetrievalGraphState): Promise<Partial<RetrievalGraphState>> {
    if (state.queryPlan.mode === 'graph') return { vectorHits: [] };
    try {
      return { vectorHits: await this.retrievalService.searchVector(state.embedding, state.documentIds) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`向量检索失败，尝试使用关键词结果 - 错误: ${message}`);
      return { vectorHits: [], errors: [`vector:${message}`] };
    }
  }

  private async keywordSearch(state: RetrievalGraphState): Promise<Partial<RetrievalGraphState>> {
    if (state.queryPlan.mode === 'graph') return { keywordHits: [] };
    try {
      return { keywordHits: await this.retrievalService.searchKeyword(state.normalizedQuery, state.documentIds) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`关键词检索失败，尝试使用向量结果 - 错误: ${message}`);
      return { keywordHits: [], errors: [`keyword:${message}`] };
    }
  }

  private async graphSearch(state: RetrievalGraphState): Promise<Partial<RetrievalGraphState>> {
    if (state.queryPlan.mode === 'text') return { graphEvidence: [] };
    try {
      return { graphEvidence: await this.retrievalService.searchGraph(state.queryPlan, state.documentIds) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`小说图谱检索失败，尝试使用文本结果 - 错误: ${message}`);
      return { graphEvidence: [], errors: [`graph:${message}`] };
    }
  }

  private fuse(state: RetrievalGraphState): Partial<RetrievalGraphState> {
    const textUnavailable =
      state.queryPlan.mode !== 'graph' &&
      state.errors.some((error) => error.startsWith('vector:')) &&
      state.errors.some((error) => error.startsWith('keyword:'));
    const graphUnavailable =
      state.queryPlan.mode !== 'text' && state.errors.some((error) => error.startsWith('graph:'));
    if (
      (state.queryPlan.mode === 'text' && textUnavailable) ||
      (state.queryPlan.mode === 'graph' && graphUnavailable) ||
      (state.queryPlan.mode === 'hybrid' && textUnavailable && graphUnavailable)
    ) {
      throw new Error('知识库检索服务暂时不可用');
    }
    return { fused: this.retrievalService.fuse(state.vectorHits, state.keywordHits) };
  }

  private async selectAndExpand(state: RetrievalGraphState): Promise<Partial<RetrievalGraphState>> {
    const selectedAndExpanded = await this.retrievalService.selectAndExpand(state.reranked);
    const selected = await this.retrievalService.attachGraphEvidence(selectedAndExpanded, state.graphEvidence);
    return { selectedAndExpanded, selected };
  }
}
