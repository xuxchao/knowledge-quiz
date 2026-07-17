import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { Document } from '../entities/document.entity';
import { Chunk } from '../entities/chunk.entity';
import { DocumentIngestionService } from '../documents/document-ingestion.service';
import { Neo4jService } from '../infrastructure/neo4j/neo4j.service';
import { ElasticsearchService } from '../infrastructure/elasticsearch/elasticsearch.service';
import { PostgresVectorService } from '../infrastructure/postgres-vector/postgres-vector.service';
import { NovelGraphExtractionService } from '../documents/novel-graph-extraction.service';
import { NovelGraphStatus } from '../entities/document.entity';

process.env.INGESTION_WORKER_AUTOSTART = 'false';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const [command, documentId] = process.argv.slice(2).filter((argument) => argument !== '--');
    const dataSource = app.get(DataSource);
    const documentRepository = dataSource.getRepository(Document);
    const chunkRepository = dataSource.getRepository(Chunk);
    const ingestion = app.get(DocumentIngestionService);
    const novelGraphExtraction = app.get(NovelGraphExtractionService);

    if (command === 'reindex' || command === 'reindex-one') {
      const documents = documentId
        ? await documentRepository.find({ where: { id: documentId } })
        : await documentRepository.find();
      for (const document of documents) {
        const source = document.url || document.path;
        if (!source) continue;
        await ingestion.enqueue(document.id, source, document.name, document.contentHash || undefined, true);
      }
      process.stdout.write(`${documents.length} document(s) queued\n`);
      return;
    }

    if (command === 'check') {
      const neo4j = app.get(Neo4jService);
      const postgresVector = app.get(PostgresVectorService);
      const elasticsearch = app.get(ElasticsearchService);
      const documents = await documentRepository.find();
      let mismatches = 0;
      if (!(await postgresVector.hasCosineHnswIndex())) {
        mismatches += 1;
        process.stdout.write('PostgreSQL cosine HNSW index is missing\n');
      }
      for (const document of documents) {
        const [postgresCount, postgresVectorCount, graphNodeCount, elasticsearchCount] = await Promise.all([
          chunkRepository.count({ where: { documentId: document.id } }),
          postgresVector.countIndexedByDocumentId(document.id),
          neo4j.countGraphNodesByDocumentId(document.id),
          elasticsearch.countByDocumentId(document.id),
        ]);
        const chunkMismatch =
          new Set([document.chunkCount, postgresCount, postgresVectorCount, elasticsearchCount]).size > 1;
        const graphMismatch = document.graphStatus === NovelGraphStatus.READY && graphNodeCount === 0;
        if (chunkMismatch || graphMismatch) {
          mismatches += 1;
          process.stdout.write(
            `查看结果: ${document.id}: document=${document.chunkCount}, postgres=${postgresCount}, vectors=${postgresVectorCount}, elasticsearch=${elasticsearchCount}, graphStatus=${document.graphStatus}, graphNodes=${graphNodeCount}\n`,
          );
        }
      }
      if (mismatches) process.exitCode = 2;
      else process.stdout.write('All indexes are consistent\n');
      return;
    }

    if (command === 'graph-rebuild' || command === 'graph-rebuild-one') {
      const documents = documentId
        ? await documentRepository.find({ where: { id: documentId } })
        : await documentRepository.find();
      for (const document of documents) {
        try {
          await novelGraphExtraction.extractAndStore(document.id);
        } catch (error: unknown) {
          await novelGraphExtraction.markFailed(document.id, error);
          throw error;
        }
      }
      process.stdout.write(`${documents.length} novel graph(s) rebuilt\n`);
      return;
    }

    if (command === 'cleanup-legacy-neo4j') {
      await app.get(Neo4jService).deleteLegacyVectorData();
      process.stdout.write('Legacy Neo4j DocumentChunk nodes and vector indexes removed\n');
      return;
    }

    throw new Error(
      'Usage: rag-maintenance <reindex|reindex-one|graph-rebuild|graph-rebuild-one|check|cleanup-legacy-neo4j> [documentId]',
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
