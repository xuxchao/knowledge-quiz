import { MigrationInterface, QueryRunner } from 'typeorm';

export class RagPipelineV21783756000000 implements MigrationInterface {
  name = 'RagPipelineV21783756000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD COLUMN "errorCode" varchar,
        ADD COLUMN "processingStage" varchar NOT NULL DEFAULT 'queued',
        ADD COLUMN "retryCount" integer NOT NULL DEFAULT 0,
        ADD COLUMN "parserVersion" varchar NOT NULL DEFAULT '2',
        ADD COLUMN "contentHash" varchar,
        ADD COLUMN "processedAt" timestamp
    `);
    await queryRunner.query(`
      ALTER TABLE "chunks"
        ADD COLUMN "pageNumber" integer,
        ADD COLUMN "sheetName" varchar,
        ADD COLUMN "rowRange" varchar,
        ADD COLUMN "slideNumber" integer,
        ADD COLUMN "headingPath" json,
        ADD COLUMN "startMs" integer,
        ADD COLUMN "endMs" integer,
        ADD COLUMN "embeddingModel" varchar NOT NULL DEFAULT 'text-embedding-v2',
        ADD COLUMN "indexStatus" varchar NOT NULL DEFAULT 'pending'
    `);
    await queryRunner.query('CREATE INDEX "IDX_documents_content_hash" ON "documents" ("contentHash")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_documents_content_hash"');
    await queryRunner.query(`
      ALTER TABLE "chunks"
        DROP COLUMN "indexStatus", DROP COLUMN "embeddingModel", DROP COLUMN "endMs", DROP COLUMN "startMs",
        DROP COLUMN "headingPath", DROP COLUMN "slideNumber", DROP COLUMN "rowRange", DROP COLUMN "sheetName",
        DROP COLUMN "pageNumber"
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP COLUMN "processedAt", DROP COLUMN "contentHash", DROP COLUMN "parserVersion", DROP COLUMN "retryCount",
        DROP COLUMN "processingStage", DROP COLUMN "errorCode"
    `);
  }
}
