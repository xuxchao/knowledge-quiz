import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { RedisModule } from '../infrastructure/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
