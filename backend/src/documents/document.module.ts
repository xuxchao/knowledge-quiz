import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../entities/document.entity';
import { Chunk } from '../entities/chunk.entity';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { ChunkController } from './chunk.controller';
import { ChunkService } from './chunk.service';
import { FileProcessorModule } from '../infrastructure/file-processor/file-processor.module';
import { Neo4jModule } from '../infrastructure/neo4j/neo4j.module';
import { RustfsModule } from '../infrastructure/rustfs/rustfs.module';
import { AiModule } from '../ai/ai.module';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { DocumentIngestionService } from './document-ingestion.service';
import { ElasticsearchModule } from '../infrastructure/elasticsearch/elasticsearch.module';
import { PostgresVectorModule } from '../infrastructure/postgres-vector/postgres-vector.module';
import { IngestionArtifactService } from './ingestion-artifact.service';
import { DocumentIngestionGraph } from './document-ingestion.graph';
import { DocumentIngestionWorker } from './document-ingestion.worker';
import { NovelGraphExtractionService } from './novel-graph-extraction.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Chunk]),
    FileProcessorModule,
    Neo4jModule,
    RustfsModule,
    AiModule,
    RedisModule,
    ElasticsearchModule,
    PostgresVectorModule,
  ],
  controllers: [DocumentController, ChunkController],
  providers: [
    DocumentService,
    ChunkService,
    DocumentIngestionService,
    IngestionArtifactService,
    DocumentIngestionGraph,
    DocumentIngestionWorker,
    NovelGraphExtractionService,
  ],
  exports: [DocumentService, ChunkService, DocumentIngestionService, NovelGraphExtractionService],
})
export class DocumentModule {}
