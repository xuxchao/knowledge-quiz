import { Module } from '@nestjs/common';
import { Mem0Service } from './mem0.service';

@Module({
  providers: [Mem0Service],
  exports: [Mem0Service],
})
export class Mem0Module {}
