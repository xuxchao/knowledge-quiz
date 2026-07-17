import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { typeOrmConfig } from './config/typeorm.config';
import { ConversationModule } from './conversations/conversation.module';
import { DocumentModule } from './documents/document.module';
import { AiModule } from './ai/ai.module';
import { MemoryModule } from './memory/memory.module';
import { LoggerModule } from './common/logger';
import { GraphModule } from './graph/graph.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../.env'),
    }),
    LoggerModule.forRoot({
      config: {
        globalLevel: process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG',
        globalEnabled: true,
        outputFormat: process.env.NODE_ENV === 'production' ? 'json' : 'console',
        file: {
          enabled: process.env.LOG_FILE_ENABLED?.toLowerCase() !== 'false',
          directory: resolve(__dirname, '../../', process.env.LOG_DIR || 'logs'),
          filename: process.env.LOG_FILE_NAME || 'backend-%DATE%.log',
          errorFilename: process.env.LOG_ERROR_FILE_NAME || 'backend-error-%DATE%.log',
          datePattern: process.env.LOG_FILE_DATE_PATTERN || 'YYYY-MM-DD',
          maxSize: process.env.LOG_FILE_MAX_SIZE || '20m',
          maxFiles: process.env.LOG_FILE_MAX_FILES || '14d',
        },
      },
    }),
    GraphModule,
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
