import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmConfig } from './config/typeorm.config';
import { ConversationModule } from './conversations/conversation.module';
import { DocumentModule } from './documents/document.module';
import { AiModule } from './ai/ai.module';
import { MemoryModule } from './memory/memory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
    }),
    TypeOrmModule.forRootAsync({
      useFactory: typeOrmConfig,
      inject: [ConfigService],
    }),
    ConversationModule,
    DocumentModule,
    AiModule,
    MemoryModule,
  ],
})
export class AppModule {}
