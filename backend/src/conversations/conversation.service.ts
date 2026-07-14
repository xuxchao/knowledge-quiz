import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';
import { DocumentReference, Message, MessageRole } from '../entities/message.entity';
import { LoggerService, LogServiceCall } from '../common/logger';

export interface MessagePage {
  messages: Message[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ConversationContextSnapshot {
  conversation: Conversation;
  messages: Message[];
}

interface MessageCursor {
  createdAt: string;
  id: string;
}

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
    return this.conversationRepository.findOne({ where: { id } });
  }

  @LogServiceCall()
  async findOwnedById(id: string, userId: string): Promise<Conversation | null> {
    return this.conversationRepository.findOne({ where: { id, userId } });
  }

  @LogServiceCall()
  async findWithMessagePage(id: string, limit = 50, before?: string): Promise<Conversation | null> {
    const conversation = await this.findById(id);
    if (!conversation) return null;

    const page = await this.getMessagePage(id, limit, before);
    conversation.messages = page.messages;
    conversation.messagePage = { nextCursor: page.nextCursor, hasMore: page.hasMore };
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
    tokenCount?: number,
  ): Promise<Message> {
    const message = this.messageRepository.create({
      conversationId,
      role,
      content,
      references,
      tokenCount: tokenCount ?? null,
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

  @LogServiceCall()
  async getMessagePage(conversationId: string, limit = 50, before?: string): Promise<MessagePage> {
    const query = this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .take(limit + 1);

    if (before) {
      const cursor = this.decodeCursor(before);
      query.andWhere('(message.createdAt < :createdAt OR (message.createdAt = :createdAt AND message.id < :id))', {
        createdAt: cursor.createdAt,
        id: cursor.id,
      });
    }

    const rows = await query.getMany();
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const oldest = pageRows[pageRows.length - 1];

    return {
      messages: pageRows.reverse(),
      hasMore,
      nextCursor: hasMore && oldest ? this.encodeCursor(oldest) : null,
    };
  }

  @LogServiceCall()
  async getContextSnapshot(conversationId: string): Promise<ConversationContextSnapshot | null> {
    const conversation = await this.findById(conversationId);
    if (!conversation) return null;

    const query = this.messageRepository
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId })
      .orderBy('message.createdAt', 'ASC')
      .addOrderBy('message.id', 'ASC');

    if (conversation.summaryThroughMessageId) {
      const checkpoint = await this.messageRepository.findOne({
        where: { id: conversation.summaryThroughMessageId, conversationId },
      });
      if (checkpoint) {
        query.andWhere(
          '(message.createdAt > :createdAt OR (message.createdAt = :createdAt AND message.id > :messageId))',
          { createdAt: checkpoint.createdAt, messageId: checkpoint.id },
        );
      }
    }

    return { conversation, messages: await query.getMany() };
  }

  @LogServiceCall()
  async updateSummary(
    conversationId: string,
    expectedVersion: number,
    summary: string,
    throughMessageId: string,
  ): Promise<boolean> {
    const result = await this.conversationRepository.update(
      { id: conversationId, summaryVersion: expectedVersion },
      {
        summary,
        summaryThroughMessageId: throughMessageId,
        summaryVersion: expectedVersion + 1,
        summaryUpdatedAt: new Date(),
      },
    );
    return result.affected === 1;
  }

  @LogServiceCall()
  async updateMessageTokenCounts(messages: Message[]): Promise<void> {
    await this.messageRepository.save(
      messages.filter((message) => message.tokenCount != null),
      { chunk: 100 },
    );
  }

  private encodeCursor(message: Message): string {
    return Buffer.from(JSON.stringify({ createdAt: message.createdAt.toISOString(), id: message.id })).toString(
      'base64url',
    );
  }

  private decodeCursor(value: string): MessageCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<MessageCursor>;
      if (!parsed.createdAt || !parsed.id || !Number.isFinite(Date.parse(parsed.createdAt))) {
        throw new Error('invalid cursor');
      }
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`消息游标解析失败 - 错误: ${errorMessage}`);
      throw new BadRequestException('Invalid message cursor');
    }
  }
}
