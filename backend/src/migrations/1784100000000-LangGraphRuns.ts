import { MigrationInterface, QueryRunner } from 'typeorm';

export class LangGraphRuns1784100000000 implements MigrationInterface {
  name = 'LangGraphRuns1784100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "graph_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "graphName" varchar NOT NULL,
        "aggregateId" uuid NOT NULL,
        "idempotencyKey" varchar NOT NULL,
        "status" varchar NOT NULL DEFAULT 'queued',
        "input" jsonb NOT NULL,
        "attemptCount" integer NOT NULL DEFAULT 0,
        "availableAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "leaseOwner" varchar,
        "leaseExpiresAt" timestamp,
        "lastNode" varchar,
        "progress" integer NOT NULL DEFAULT 0,
        "errorCode" varchar,
        "errorMessage" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_graph_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_graph_runs_graph_idempotency" ON "graph_runs" ("graphName", "idempotencyKey")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_graph_runs_claim" ON "graph_runs" ("status", "availableAt", "leaseExpiresAt")',
    );
    await queryRunner.query('ALTER TABLE "chunks" ADD COLUMN "ingestionRunId" uuid');
    await queryRunner.query(`
      DELETE FROM "chunks" older
      USING "chunks" newer
      WHERE older."documentId" = newer."documentId"
        AND older."chunkIndex" = newer."chunkIndex"
        AND (
          older."createdAt" < newer."createdAt"
          OR (older."createdAt" = newer."createdAt" AND older."id" < newer."id")
        )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_chunks_document_index" ON "chunks" ("documentId", "chunkIndex")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "UQ_chunks_document_index"');
    await queryRunner.query('ALTER TABLE "chunks" DROP COLUMN "ingestionRunId"');
    await queryRunner.query('DROP INDEX "IDX_graph_runs_claim"');
    await queryRunner.query('DROP INDEX "UQ_graph_runs_graph_idempotency"');
    await queryRunner.query('DROP TABLE "graph_runs"');
  }
}
