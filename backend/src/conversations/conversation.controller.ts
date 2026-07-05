import { Controller, Get, Delete, Param, Query } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { LoggerService } from '../common/logger';

@Controller('conversations')
export class ConversationController {
  private readonly logger = new LoggerService(ConversationController.name);

  constructor(private conversationService: ConversationService) {}

  @Get()
  async listConversations(@Query('userId') userId?: string) {
    this.logger.debug(`请求进入 - 获取会话列表，用户ID: ${userId || '无'}`);

    const conversations = await this.conversationService.findAll(userId);

    this.logger.info(`请求成功 - 获取会话列表完成，总数: ${conversations.length}`);

    return {
      success: true,
      data: conversations,
    };
  }

  @Get('get/:id')
  async getConversation(@Param('id') id: string) {
    this.logger.debug(`请求进入 - 获取会话，ID: ${id}`);

    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      this.logger.warn(`会话未找到 - ID: ${id}`);
      throw new Error('Conversation not found');
    }

    this.logger.info(`请求成功 - 获取会话完成，ID: ${id}`);

    return {
      success: true,
      data: conversation,
    };
  }

  @Delete('delete/:id')
  async deleteConversation(@Param('id') id: string) {
    this.logger.debug(`请求进入 - 删除会话，ID: ${id}`);

    const conversation = await this.conversationService.findById(id);
    if (!conversation) {
      this.logger.warn(`会话未找到 - ID: ${id}`);
      throw new Error('Conversation not found');
    }

    await this.conversationService.delete(id);

    this.logger.info(`请求成功 - 删除会话完成，ID: ${id}`);

    return {
      success: true,
      message: 'Conversation deleted successfully',
    };
  }
}
