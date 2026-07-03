import { Controller, Get, Delete, Param, Query } from '@nestjs/common';
import { ConversationService } from './conversation.service';

@Controller('conversations')
export class ConversationController {
  constructor(private conversationService: ConversationService) {}

  @Get()
  async listConversations(@Query('userId') userId?: string) {
    const conversations = await this.conversationService.findAll(userId);
    return {
      success: true,
      data: conversations,
    };
  }

  @Get('get/:id')
  async getConversation(@Param('id') id: string) {
    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    return {
      success: true,
      data: conversation,
    };
  }

  @Delete('delete/:id')
  async deleteConversation(@Param('id') id: string) {
    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.conversationService.delete(id);
    return {
      success: true,
      message: 'Conversation deleted successfully',
    };
  }
}
