import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message]), MemoryModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
