import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DocumentIngestionWorker } from '../documents/document-ingestion.worker';

process.env.INGESTION_WORKER_AUTOSTART = 'false';
process.env.LOG_FILE_NAME = 'backend-worker-%DATE%.log';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const worker = app.get(DocumentIngestionWorker);
  const shutdown = async () => {
    worker.stop();
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await worker.start();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
