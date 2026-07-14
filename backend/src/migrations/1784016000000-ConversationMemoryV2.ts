import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationMemoryV21784016000000 implements MigrationInterface {
  name = 'ConversationMemoryV21784016000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summary" text`);
    await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summaryThroughMessageId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summaryVersion" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "summaryUpdatedAt" timestamp`);
    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "tokenCount" integer`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_conversation_created"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_conversation_created_id" ON "messages" ("conversationId", "createdAt" DESC, "id" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_conversation_created_id"`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_conversation_created" ON "messages" ("conversationId", "createdAt")`,
    );
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "tokenCount"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "summaryUpdatedAt"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "summaryVersion"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "summaryThroughMessageId"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "summary"`);
  }
}
