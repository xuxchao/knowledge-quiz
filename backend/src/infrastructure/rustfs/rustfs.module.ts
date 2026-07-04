import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RustfsService } from './rustfs.service';

@Module({
  imports: [ConfigModule],
  providers: [RustfsService],
  exports: [RustfsService],
})
export class RustfsModule {}
