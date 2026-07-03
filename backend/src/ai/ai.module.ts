import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ChatController } from './chat.controller';
import { ConversationModule } from '../conversations/conversation.module';
import { MemoryModule } from '../memory/memory.module';
import { Neo4jModule } from '../infrastructure/neo4j/neo4j.module';

@Module({
  imports: [ConversationModule, MemoryModule, Neo4jModule],
  controllers: [ChatController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
