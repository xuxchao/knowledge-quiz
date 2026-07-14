import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { Mem0Module } from '../infrastructure/mem0/mem0.module';

@Module({
  imports: [Mem0Module],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
