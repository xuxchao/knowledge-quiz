import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';
import { Message, MessageRole } from '../entities/message.entity';
import { LoggerService, LogServiceCall } from '../common/logger';

@Injectable()
export class ConversationService {
  private readonly logger = new LoggerService(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
  ) {}

  @LogServiceCall()
  async create(data: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.conversationRepository.create(data);
    return this.conversationRepository.save(conversation);
  }

  @LogServiceCall()
  async findById(id: string): Promise<Conversation | null> {
    return this.conversationRepository.findOne({
      where: { id },
      relations: { messages: true },
    });
  }

  @LogServiceCall()
  async findAll(userId?: string): Promise<Conversation[]> {
    const query = this.conversationRepository.createQueryBuilder('conversation');

    if (userId) {
      query.where('conversation.userId = :userId', { userId });
    }

    query.orderBy('conversation.updatedAt', 'DESC');

    return query.getMany();
  }

  @LogServiceCall()
  async delete(id: string): Promise<void> {
    await this.messageRepository.delete({ conversationId: id });
    await this.conversationRepository.delete(id);
  }

  @LogServiceCall()
  async createMessage(conversationId: string, role: MessageRole, content: string): Promise<Message> {
    const message = this.messageRepository.create({
      conversationId,
      role,
      content,
    });

    await this.messageRepository.save(message);

    await this.conversationRepository.update(conversationId, {
      updatedAt: new Date(),
    });

    return message;
  }

  @LogServiceCall()
  async getMessages(conversationId: string): Promise<Message[]> {
    return this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }
}