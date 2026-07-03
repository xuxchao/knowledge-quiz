import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Document } from '../entities/document.entity';
import { Chunk } from '../entities/chunk.entity';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';

export const typeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('POSTGRES_HOST', 'localhost'),
  port: configService.get<number>('POSTGRES_PORT', 5432),
  username: configService.get<string>('POSTGRES_USER', 'admin'),
  password: configService.get<string>('POSTGRES_PASSWORD', 'password'),
  database: configService.get<string>('POSTGRES_DB', 'knowledge_doc'),
  entities: [Document, Chunk, Conversation, Message],
  migrations: [__dirname + '/../migrations/**/*.ts'],
  synchronize: configService.get<string>('NODE_ENV') !== 'production',
  logging: configService.get<string>('NODE_ENV') !== 'production',
});
