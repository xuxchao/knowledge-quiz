import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1783755000000 implements MigrationInterface {
  name = 'InitialSchema1783755000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "type" varchar NOT NULL,
        "path" varchar,
        "storageKey" varchar,
        "url" text,
        "status" varchar NOT NULL DEFAULT 'uploading',
        "errorMessage" text,
        "metadata" json,
        "chunkCount" integer NOT NULL DEFAULT 0,
        "fileSize" bigint NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chunks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "documentId" varchar NOT NULL,
        "content" text NOT NULL,
        "chunkIndex" integer NOT NULL,
        "tokenCount" integer NOT NULL DEFAULT 500,
        "metadata" json,
        "embedding" text,
        "contentSearch" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_chunks_document" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" varchar,
        "title" varchar,
        "metadata" json,
        "messageCount" integer NOT NULL DEFAULT 0,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversationId" varchar NOT NULL,
        "role" varchar NOT NULL,
        "content" text NOT NULL,
        "metadata" json,
        "references" json,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_messages_conversation" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chunks_document" ON "chunks" ("documentId", "chunkIndex")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_conversation_created" ON "messages" ("conversationId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_conversations_user_updated" ON "conversations" ("userId", "updatedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_documents_name_trgm" ON "documents" USING gin ("name" gin_trgm_ops)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chunks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "documents"`);
  }
}
