import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LoggerService, LogServiceCall } from '../common/logger';
import type { GraphEvidence, NovelQueryPlan } from '../infrastructure/neo4j/novel-graph.types';
import type { RetrievedChunk, VectorSearchHit } from './retrieval.service';
import type { SearchChunk } from '../infrastructure/elasticsearch/elasticsearch.service';

export interface RetrievalSnapshotInput {
  conversationId?: string;
  startedAt: Date;
  query: string;
  normalizedQuery: string;
  documentIds?: string[];
  queryPlan: NovelQueryPlan;
  errors: string[];
  stages: {
    postgresVector: VectorSearchHit[];
    elasticsearch: SearchChunk[];
    neo4j: GraphEvidence[];
    fused: RetrievedChunk[];
    reranked: RetrievedChunk[];
    selectAndExpand: RetrievedChunk[];
    final: RetrievedChunk[];
  };
}

@Injectable()
export class RetrievalSnapshotService {
  private readonly logger = new LoggerService(RetrievalSnapshotService.name);
  private readonly enabled: boolean;
  private readonly outputDirectory = resolve(__dirname, '../../../logs/retrieval');

  constructor(configService: ConfigService) {
    this.enabled = configService.get<string>('RETRIEVAL_SNAPSHOT_ENABLED', 'false').toLowerCase() === 'true';
  }

  @LogServiceCall()
  async write(input: RetrievalSnapshotInput): Promise<void> {
    if (!this.enabled) return;

    const retrievalId = randomUUID();
    const completedAt = new Date();
    const snapshot = {
      schemaVersion: 1,
      retrievalId,
      conversationId: input.conversationId,
      startedAt: input.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - input.startedAt.getTime(),
      query: input.query,
      normalizedQuery: input.normalizedQuery,
      documentIds: input.documentIds,
      queryPlan: input.queryPlan,
      errors: input.errors,
      counts: {
        postgresVector: input.stages.postgresVector.length,
        elasticsearch: input.stages.elasticsearch.length,
        neo4j: input.stages.neo4j.length,
        fused: input.stages.fused.length,
        reranked: input.stages.reranked.length,
        selectAndExpand: input.stages.selectAndExpand.length,
        final: input.stages.final.length,
      },
      stages: {
        initial: {
          postgresVector: input.stages.postgresVector,
          elasticsearch: input.stages.elasticsearch,
          neo4j: input.stages.neo4j,
        },
        fused: input.stages.fused,
        reranked: input.stages.reranked,
        selectAndExpand: input.stages.selectAndExpand,
        final: input.stages.final,
      },
    };
    const timestamp = completedAt.toISOString().replace(/[:.]/g, '-');
    const conversationId = this.sanitizeFilePart(input.conversationId || 'no-conversation');
    const fileName = `${timestamp}_${conversationId}_${retrievalId}.json`;

    try {
      await mkdir(this.outputDirectory, { recursive: true });
      await writeFile(resolve(this.outputDirectory, fileName), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      this.logger.debug(`检索快照写入完成 - retrievalId: ${retrievalId}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.logger.error(`检索快照写入失败 - retrievalId: ${retrievalId}，错误: ${message}`, stackTrace);
    }
  }

  private sanitizeFilePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'unknown';
  }
}
