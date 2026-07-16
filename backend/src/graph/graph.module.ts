import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphRun } from '../entities/graph-run.entity';
import { GraphCheckpointService } from './graph-checkpoint.service';
import { GraphRunService } from './graph-run.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([GraphRun])],
  providers: [GraphRunService, GraphCheckpointService],
  exports: [GraphRunService, GraphCheckpointService],
})
export class GraphModule {}
