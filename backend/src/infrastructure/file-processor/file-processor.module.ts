import { Module } from '@nestjs/common';
import { FileProcessorService } from './file-processor.service';
import { AiModule } from '../../ai/ai.module';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { SpeechModule } from '../speech/speech.module';

@Module({
  imports: [AiModule, Neo4jModule, SpeechModule],
  providers: [FileProcessorService],
  exports: [FileProcessorService],
})
export class FileProcessorModule {}
