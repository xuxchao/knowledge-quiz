import { Module } from '@nestjs/common';
import { FileProcessorService } from './file-processor.service';
import { AiModule } from '../../ai/ai.module';
import { SpeechModule } from '../speech/speech.module';
import { RustfsModule } from '../rustfs/rustfs.module';

@Module({
  imports: [AiModule, SpeechModule, RustfsModule],
  providers: [FileProcessorService],
  exports: [FileProcessorService],
})
export class FileProcessorModule {}
