import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import type { Relation } from 'typeorm';
import { Conversation } from './conversation.entity';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export interface DocumentReference {
  documentId: string;
  documentName: string;
  downloadUrl: string;
  chunkIndex: number;
  content: string;
  score: number;
}

@Entity('messages')
@Index('IDX_messages_conversation_created', ['conversationId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  conversation: Relation<Conversation>;

  @Column({ type: 'varchar' })
  conversationId: string;

  @Column({ type: 'varchar', enum: MessageRole })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown>;

  @Column({ type: 'json', nullable: true })
  references: DocumentReference[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
