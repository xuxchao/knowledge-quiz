import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { Document } from '../entities/document.entity';
import { Chunk } from '../entities/chunk.entity';
import { DocumentIngestionService } from '../documents/document-ingestion.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { ElasticsearchService } from '../infrastructure/elasticsearch/elasticsearch.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const [command, documentId] = process.argv.slice(2);
    const dataSource = app.get(DataSource);
    const documentRepository = dataSource.getRepository(Document);
    const chunkRepository = dataSource.getRepository(Chunk);
    const ingestion = app.get(DocumentIngestionService);

    if (command === 'reindex' || command === 'reindex-one') {
      const documents = documentId
        ? await documentRepository.find({ where: { id: documentId } })
        : await documentRepository.find();
      for (const document of documents) {
        const source = document.url || document.path;
        if (!source) continue;
        await ingestion.enqueue(document.id, source, document.name, document.contentHash || undefined);
      }
      process.stdout.write(`${documents.length} document(s) queued\n`);
      return;
    }

    if (command === 'check') {
      const neo4j = app.get(Neo4jService);
      const elasticsearch = app.get(ElasticsearchService);
      const documents = await documentRepository.find();
      let mismatches = 0;
      for (const document of documents) {
        const [postgresCount, neo4jCount, elasticsearchCount] = await Promise.all([
          chunkRepository.count({ where: { documentId: document.id } }),
          neo4j.countByDocumentId(document.id),
          elasticsearch.countByDocumentId(document.id),
        ]);
        if (new Set([document.chunkCount, postgresCount, neo4jCount, elasticsearchCount]).size > 1) {
          mismatches += 1;
          process.stdout.write(
            `${document.id}: document=${document.chunkCount}, postgres=${postgresCount}, neo4j=${neo4jCount}, elasticsearch=${elasticsearchCount}\n`,
          );
        }
      }
      if (mismatches) process.exitCode = 2;
      else process.stdout.write('All indexes are consistent\n');
      return;
    }

    throw new Error('Usage: rag-maintenance <reindex|reindex-one|check> [documentId]');
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
