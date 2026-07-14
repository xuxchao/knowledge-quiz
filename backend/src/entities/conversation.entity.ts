import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import type { Relation } from 'typeorm';
import { Message } from './message.entity';

export interface MessagePageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

@Entity('conversations')
@Index('IDX_conversations_user_updated', ['userId', 'updatedAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  title: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'integer', default: 0 })
  messageCount: number;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'uuid', nullable: true })
  summaryThroughMessageId: string | null;

  @Column({ type: 'integer', default: 0 })
  summaryVersion: number;

  @Column({ type: 'timestamp', nullable: true })
  summaryUpdatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => Message, (message) => message.conversation)
  messages: Relation<Message[]>;

  messagePage?: MessagePageInfo;
}
