import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatController } from './chat.controller';
import { ConversationModule } from '../conversations/conversation.module';
import { MemoryModule } from '../memory/memory.module';
import { Neo4jModule } from '../infrastructure/neo4j/neo4j.module';
import { LangfuseModule } from '../infrastructure/langfuse/langfuse.module';
import { ElasticsearchModule } from '../infrastructure/elasticsearch/elasticsearch.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chunk } from '../entities/chunk.entity';
import { RetrievalService } from './retrieval.service';
import { ConversationContextService } from './conversation-context.service';
import { TokenBudgetService } from './token-budget.service';
import { RetrievalGraph } from './retrieval.graph';
import { RagChatGraph } from './rag-chat.graph';

@Module({
  imports: [
    ConversationModule,
    MemoryModule,
    Neo4jModule,
    LangfuseModule,
    ElasticsearchModule,
    TypeOrmModule.forFeature([Chunk]),
  ],
  controllers: [ChatController],
  providers: [
    AiService,
    RetrievalService,
    RetrievalGraph,
    RagChatGraph,
    ConversationContextService,
    TokenBudgetService,
  ],
  exports: [AiService, RetrievalService, RetrievalGraph, RagChatGraph, ConversationContextService, TokenBudgetService],
})
export class AiModule {}
