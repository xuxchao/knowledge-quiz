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

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Chunk]),
    FileProcessorModule,
    Neo4jModule,
  ],
  controllers: [DocumentController, ChunkController],
  providers: [DocumentService, ChunkService],
  exports: [DocumentService, ChunkService],
})
export class DocumentModule {}
