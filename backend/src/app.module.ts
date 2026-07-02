import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { MulterModule } from '@nestjs/platform-express';
import { typeOrmConfig } from './config/typeorm.config';
import { Document } from './entities/document.entity';
import { Chunk } from './entities/chunk.entity';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { DocumentController } from './controllers/document.controller';
import { ChunkController } from './controllers/chunk.controller';
import { ConversationController } from './controllers/conversation.controller';
import { DocumentService } from './services/document.service';
import { ChunkService } from './services/chunk.service';
import { ConversationService } from './services/conversation.service';
import { FileProcessorService } from './services/file-processor.service';
import { AiService } from './services/ai.service';
import { SpeechService } from './services/speech.service';
import { Neo4jService } from './services/neo4j.service';
import { RedisService } from './services/redis.service';
import { MemoryService } from './services/memory.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      useFactory: typeOrmConfig,
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Document, Chunk, Conversation, Message]),
    MulterModule.register({
      dest: './uploads',
    }),
    ServeStaticModule.forRoot({
      rootPath: './uploads',
      serveRoot: '/uploads',
    }),
  ],
  controllers: [DocumentController, ChunkController, ConversationController],
  providers: [
    DocumentService,
    ChunkService,
    ConversationService,
    FileProcessorService,
    AiService,
    SpeechService,
    Neo4jService,
    RedisService,
    MemoryService,
  ],
})
export class AppModule {}
