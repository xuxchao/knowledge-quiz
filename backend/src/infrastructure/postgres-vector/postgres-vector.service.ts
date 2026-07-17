import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { LogServiceCall } from '../../common/logger';

export interface PostgresVectorHit {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

interface VectorRow {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown> | null;
  documentName: string;
  score: number | string;
}

@Injectable()
export class PostgresVectorService implements OnModuleInit {
  private readonly dimensions: number;

  constructor(
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.dimensions = Number(configService.get<string>('EMBEDDING_DIMENSIONS', '1536'));
  }

  @LogServiceCall()
  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chunks_embedding_hnsw"
      ON "chunks" USING hnsw ("embedding" vector_cosine_ops)
    `);
  }

  @LogServiceCall()
  async search(queryEmbedding: number[], topK = 30, documentIds?: string[]): Promise<PostgresVectorHit[]> {
    this.validateEmbedding(queryEmbedding);
    const rows = await this.dataSource.query<VectorRow[]>(
      `
        SELECT
          c."id" AS "chunkId",
          c."documentId" AS "documentId",
          c."content" AS "content",
          c."chunkIndex" AS "chunkIndex",
          c."metadata" AS "metadata",
          d."name" AS "documentName",
          1 - (c."embedding" <=> $1::vector) AS "score"
        FROM "chunks" c
        INNER JOIN "documents" d ON d."id" = c."documentId"
        WHERE c."embedding" IS NOT NULL
          AND (cardinality($2::uuid[]) = 0 OR c."documentId" = ANY($2::uuid[]))
        ORDER BY c."embedding" <=> $1::vector
        LIMIT $3
      `,
      [this.toVectorLiteral(queryEmbedding), documentIds ?? [], Math.max(1, Math.min(topK, 100))],
    );

    return rows.map((row) => ({
      content: row.content,
      score: Number(row.score),
      metadata: {
        ...(row.metadata ?? {}),
        chunkId: row.chunkId,
        documentId: row.documentId,
        documentName: row.documentName,
        chunkIndex: row.chunkIndex,
      },
    }));
  }

  @LogServiceCall()
  async countIndexedByDocumentId(documentId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM "chunks" WHERE "documentId" = $1 AND "embedding" IS NOT NULL',
      [documentId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  @LogServiceCall()
  async hasCosineHnswIndex(): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ exists: boolean }>>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'chunks'
          AND indexname = 'IDX_chunks_embedding_hnsw'
          AND indexdef ILIKE '%USING hnsw%'
          AND indexdef ILIKE '%vector_cosine_ops%'
      ) AS "exists"
    `);
    return rows[0]?.exists === true;
  }

  private validateEmbedding(embedding: number[]): void {
    if (embedding.length !== this.dimensions || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error(`Embedding维度或数值无效，期望${this.dimensions}维`);
    }
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
