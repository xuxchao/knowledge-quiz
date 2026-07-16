import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { DocumentStatus, FileType, ProcessingStage } from '../entities/document.entity';
import { GraphRun } from '../entities/graph-run.entity';
import { GraphCheckpointService } from '../graph/graph-checkpoint.service';
import { GraphRunService } from '../graph/graph-run.service';
import { LoggerService, LogServiceCall } from '../common/logger';
import { FileProcessorService, ParsedDocument, StructuredChunk } from '../infrastructure/file-processor/file-processor.service';
import { ChunkService } from './chunk.service';
import { DocumentService } from './document.service';
import { IngestionArtifactService } from './ingestion-artifact.service';

export interface DocumentIngestionInput extends Record<string, unknown> {
  runId: string;
  documentId: string;
  filePath: string;
  fileName: string;
  fileType: FileType;
  contentHash: string;
  parserVersion: string;
}

const IngestionState = Annotation.Root({
  runId: Annotation<string>(),
  documentId: Annotation<string>(),
  filePath: Annotation<string>(),
  fileName: Annotation<string>(),
  fileType: Annotation<FileType>(),
  contentHash: Annotation<string>(),
  parserVersion: Annotation<string>(),
  parsedArtifactKey: Annotation<string | undefined>(),
  chunksArtifactKey: Annotation<string | undefined>(),
  parsedMetadata: Annotation<Record<string, unknown>>({ reducer: (_left, right) => right, default: () => ({}) }),
  chunkCount: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  indexedStores: Annotation<string[]>({
    reducer: (left, right) => [...new Set([...left, ...right])],
    default: () => [],
  }),
});

type IngestionGraphState = typeof IngestionState.State;

@Injectable()
export class DocumentIngestionGraph {
  private readonly logger = new LoggerService(DocumentIngestionGraph.name);

  constructor(
    private readonly checkpointService: GraphCheckpointService,
    private readonly graphRunService: GraphRunService,
    private readonly documentService: DocumentService,
    private readonly chunkService: ChunkService,
    private readonly fileProcessorService: FileProcessorService,
    private readonly artifactService: IngestionArtifactService,
  ) {}

  @LogServiceCall()
  async execute(run: GraphRun): Promise<void> {
    const checkpointer = await this.checkpointService.get();
    const graph = this.build().compile({ checkpointer });
    const config: RunnableConfig = {
      configurable: { thread_id: run.id, checkpoint_ns: 'document-ingestion-v1' },
      runName: 'ingestion.graph',
      tags: ['ingestion', 'langgraph'],
      metadata: { runId: run.id, documentId: run.aggregateId },
    };
    const checkpoint = await checkpointer.get(config);
    await graph.invoke(checkpoint ? null : ({ ...run.input, runId: run.id } as DocumentIngestionInput), config);
  }

  @LogServiceCall()
  async handleFailure(run: GraphRun, error: Error, retrying: boolean): Promise<void> {
    if (retrying) {
      await this.documentService.update(run.aggregateId, {
        retryCount: run.attemptCount + 1,
        errorCode: 'GRAPH_RUN_RETRY',
        errorMessage: error.message,
      });
      return;
    }

    try {
      await this.chunkService.cleanupDocument(run.aggregateId);
    } catch (cleanupError: unknown) {
      this.logCompensationError(run.id, '清理文档索引失败', cleanupError);
    }
    try {
      await this.artifactService.cleanup(this.artifactKeys(run.id));
    } catch (cleanupError: unknown) {
      this.logCompensationError(run.id, '清理摄取中间产物失败', cleanupError);
    }
    await this.documentService.update(run.aggregateId, {
      status: DocumentStatus.FAILED,
      processingStage: ProcessingStage.FAILED,
      retryCount: run.attemptCount + 1,
      errorCode: 'INGESTION_FAILED',
      errorMessage: error.message,
    });
  }

  private build() {
    return new StateGraph(IngestionState)
      .addNode('prepare', (state) => this.prepare(state))
      .addNode('cleanupPrevious', (state) => this.cleanupPrevious(state))
      .addNode('extract', (state) => this.extract(state))
      .addNode('validateDocument', (state) => this.validateDocument(state))
      .addNode('chunk', (state) => this.chunk(state))
      .addNode('embedAndStage', (state) => this.embedAndStage(state))
      .addNode('indexNeo4j', (state: IngestionGraphState) => this.indexNeo4j(state), {
        retryPolicy: { maxAttempts: 3 },
      })
      .addNode('indexElasticsearch', (state: IngestionGraphState) => this.indexElasticsearch(state), {
        retryPolicy: { maxAttempts: 3 },
      })
      .addNode('finalize', (state) => this.finalize(state))
      .addNode('cleanupArtifacts', (state) => this.cleanupArtifacts(state))
      .addEdge(START, 'prepare')
      .addEdge('prepare', 'cleanupPrevious')
      .addEdge('cleanupPrevious', 'extract')
      .addEdge('extract', 'validateDocument')
      .addEdge('validateDocument', 'chunk')
      .addEdge('chunk', 'embedAndStage')
      .addEdge('embedAndStage', 'indexNeo4j')
      .addEdge('embedAndStage', 'indexElasticsearch')
      .addEdge(['indexNeo4j', 'indexElasticsearch'], 'finalize')
      .addEdge('finalize', 'cleanupArtifacts')
      .addEdge('cleanupArtifacts', END);
  }

  private async prepare(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    const document = await this.documentService.findById(state.documentId, false);
    if (!document) throw new Error('文档不存在');
    await this.setStage(state, ProcessingStage.QUEUED, 5, 'prepare');
    return {};
  }

  private async cleanupPrevious(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.chunkService.cleanupDocument(state.documentId);
    await this.graphRunService.updateNode(state.runId, 'cleanupPrevious', 8);
    return {};
  }

  private async extract(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.setStage(state, ProcessingStage.EXTRACTING, 10, 'extract');
    const parsed = await this.withNodeTimeout('extract', () =>
      this.fileProcessorService.processFile(state.filePath, state.fileName, state.fileType),
    );
    const parsedArtifactKey = await this.artifactService.writeJson(state.runId, 'parsed', parsed);
    return { parsedArtifactKey, parsedMetadata: parsed.metadata };
  }

  private async validateDocument(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    const parsed = await this.readParsed(state);
    if (!parsed.text.trim() || parsed.sections.length === 0) throw new Error('文档未提取到可索引内容');
    const pageCount = Number(parsed.metadata.pageCount || 0);
    if (pageCount > Number(process.env.RAG_MAX_PAGES || 1000)) throw new Error('文档页数超过处理限制');
    await this.graphRunService.updateNode(state.runId, 'validateDocument', 30);
    return {};
  }

  private async chunk(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.setStage(state, ProcessingStage.CHUNKING, 35, 'chunk');
    const parsed = await this.readParsed(state);
    const chunks = await this.fileProcessorService.splitSections(parsed.sections);
    if (!chunks.length) throw new Error('文档未生成有效分块');
    if (chunks.length > Number(process.env.RAG_MAX_CHUNKS || 10000)) throw new Error('文档分块数超过处理限制');
    const totalTokens = chunks.reduce((sum, item) => sum + item.tokenCount, 0);
    if (totalTokens > Number(process.env.RAG_MAX_TOKENS || 2000000)) throw new Error('文档Token总数超过处理限制');
    const chunksArtifactKey = await this.artifactService.writeJson(state.runId, 'chunks', chunks);
    return { chunksArtifactKey, chunkCount: chunks.length };
  }

  private async embedAndStage(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.setStage(state, ProcessingStage.EMBEDDING, 55, 'embedAndStage');
    if (!state.chunksArtifactKey) throw new Error('分块产物不存在');
    const chunks = await this.artifactService.readJson<StructuredChunk[]>(state.chunksArtifactKey);
    const enriched = await this.withNodeTimeout('embedAndStage', () =>
      this.fileProcessorService.storeChunks(state.documentId, chunks, state.fileName),
    );
    await this.chunkService.stageForDocument(state.documentId, enriched, state.runId);
    return { chunkCount: enriched.length };
  }

  private async indexNeo4j(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.setStage(state, ProcessingStage.INDEXING, 75, 'indexNeo4j');
    await this.withNodeTimeout('indexNeo4j', () => this.chunkService.indexNeo4j(state.documentId));
    return { indexedStores: ['neo4j'] };
  }

  private async indexElasticsearch(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.setStage(state, ProcessingStage.INDEXING, 80, 'indexElasticsearch');
    await this.withNodeTimeout('indexElasticsearch', () => this.chunkService.indexElasticsearch(state.documentId));
    return { indexedStores: ['elasticsearch'] };
  }

  private async finalize(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    if (!state.indexedStores.includes('neo4j') || !state.indexedStores.includes('elasticsearch')) {
      throw new Error('文档外部索引未全部完成');
    }
    await this.chunkService.markIndexed(state.documentId);
    await this.documentService.update(state.documentId, {
      status: DocumentStatus.PROCESSED,
      processingStage: ProcessingStage.PROCESSED,
      metadata: state.parsedMetadata,
      chunkCount: state.chunkCount,
      processedAt: new Date(),
      errorMessage: null,
      errorCode: null,
    });
    await this.graphRunService.updateNode(state.runId, 'finalize', 95);
    return {};
  }

  private async cleanupArtifacts(state: IngestionGraphState): Promise<Partial<IngestionGraphState>> {
    await this.artifactService.cleanup([state.parsedArtifactKey, state.chunksArtifactKey]);
    await this.graphRunService.updateNode(state.runId, 'cleanupArtifacts', 100);
    return {};
  }

  private async setStage(
    state: IngestionGraphState,
    stage: ProcessingStage,
    progress: number,
    node: string,
  ): Promise<void> {
    await Promise.all([
      this.documentService.update(state.documentId, { processingStage: stage }),
      this.graphRunService.updateNode(state.runId, node, progress),
    ]);
  }

  private async readParsed(state: IngestionGraphState): Promise<ParsedDocument> {
    if (!state.parsedArtifactKey) throw new Error('解析产物不存在');
    return this.artifactService.readJson<ParsedDocument>(state.parsedArtifactKey);
  }

  private artifactKeys(runId: string): string[] {
    return [`_ingestion/${runId}/parsed.json.gz`, `_ingestion/${runId}/chunks.json.gz`];
  }

  private logCompensationError(runId: string, message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`${message} - 运行ID: ${runId}，错误: ${errorMessage}`, stack);
  }

  private async withNodeTimeout<T>(node: string, operation: () => Promise<T>): Promise<T> {
    const timeoutMs = Number(process.env.GRAPH_NODE_TIMEOUT_MS || 120000);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`LangGraph节点超时: ${node}`)), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
