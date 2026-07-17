import { Module } from '@nestjs/common';
import { SpeechService } from './speech.service';
import { LangfuseModule } from '../langfuse/langfuse.module';

@Module({
  imports: [LangfuseModule],
  providers: [SpeechService],
  exports: [SpeechService],
})
export class SpeechModule {}
