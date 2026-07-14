import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { RedisModule } from '../infrastructure/redis/redis.module';
import { Mem0Module } from '../infrastructure/mem0/mem0.module';

@Module({
  imports: [RedisModule, Mem0Module],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
