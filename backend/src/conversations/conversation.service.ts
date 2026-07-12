import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';
import { DocumentReference, Message, MessageRole } from '../entities/message.entity';
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
  async findById(id: string, messageSkip: number = 0, messageLimit: number = 100): Promise<Conversation | null> {
    const conversation = await this.conversationRepository.findOne({ where: { id } });
    if (!conversation) return null;

    conversation.messages = await this.getMessages(id, messageSkip, messageLimit);
    return conversation;
  }

  @LogServiceCall()
  async findAll(userId?: string, skip: number = 0, limit: number = 20): Promise<[Conversation[], number]> {
    const query = this.conversationRepository.createQueryBuilder('conversation');

    if (userId) {
      query.where('conversation.userId = :userId', { userId });
    }

    query.orderBy('conversation.updatedAt', 'DESC');
    query.skip(skip).take(limit);

    return query.getManyAndCount();
  }

  @LogServiceCall()
  async updateTitle(id: string, title: string): Promise<void> {
    await this.conversationRepository.update(id, { title });
  }

  @LogServiceCall()
  async delete(id: string): Promise<void> {
    await this.messageRepository.delete({ conversationId: id });
    await this.conversationRepository.delete(id);
  }

  @LogServiceCall()
  async createMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    references: DocumentReference[] = [],
  ): Promise<Message> {
    const message = this.messageRepository.create({
      conversationId,
      role,
      content,
      references,
    });

    await this.messageRepository.save(message);

    await this.conversationRepository.update(conversationId, {
      updatedAt: new Date(),
    });
    await this.conversationRepository.increment({ id: conversationId }, 'messageCount', 1);

    return message;
  }

  @LogServiceCall()
  async getMessages(conversationId: string, skip: number = 0, limit: number = 100): Promise<Message[]> {
    return this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });
  }
}
