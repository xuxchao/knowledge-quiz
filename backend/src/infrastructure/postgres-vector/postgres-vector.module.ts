import { Module } from '@nestjs/common';
import { PostgresVectorService } from './postgres-vector.service';

@Module({
  providers: [PostgresVectorService],
  exports: [PostgresVectorService],
})
export class PostgresVectorModule {}
