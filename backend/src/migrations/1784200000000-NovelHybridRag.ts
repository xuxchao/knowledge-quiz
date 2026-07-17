import { MigrationInterface, QueryRunner } from 'typeorm';

export class NovelHybridRag1784200000000 implements MigrationInterface {
  name = 'NovelHybridRag1784200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_chunks_embedding_hnsw"');
    await queryRunner.query(`
      ALTER TABLE "chunks"
      ALTER COLUMN "embedding" TYPE vector(1536)
      USING CASE
        WHEN "embedding" IS NULL OR btrim("embedding") = '' THEN NULL
        ELSE "embedding"::vector
      END
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chunks_embedding_hnsw"
      ON "chunks" USING hnsw ("embedding" vector_cosine_ops)
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD COLUMN "graphStatus" varchar NOT NULL DEFAULT 'pending',
        ADD COLUMN "graphVersion" varchar,
        ADD COLUMN "graphError" text,
        ADD COLUMN "graphUpdatedAt" timestamp
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
        DROP COLUMN "graphUpdatedAt",
        DROP COLUMN "graphError",
        DROP COLUMN "graphVersion",
        DROP COLUMN "graphStatus"
    `);
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_chunks_embedding_hnsw"');
    await queryRunner.query(`
      ALTER TABLE "chunks"
      ALTER COLUMN "embedding" TYPE text
      USING "embedding"::text
    `);
  }
}
