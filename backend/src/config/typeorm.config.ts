import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Document } from '../entities/document.entity';
import { Chunk } from '../entities/chunk.entity';
import { Conversation } from '../entities/conversation.entity';
import { Message } from '../entities/message.entity';
import { GraphRun } from '../entities/graph-run.entity';

const formatSql = (sql: string): string => {
  if (!sql) return '';
  const formatted = sql
    .replace(/SELECT\s+/gi, '\nSELECT ')
    .replace(/FROM\s+/gi, '\nFROM ')
    .replace(/LEFT JOIN\s+/gi, '\nLEFT JOIN ')
    .replace(/RIGHT JOIN\s+/gi, '\nRIGHT JOIN ')
    .replace(/INNER JOIN\s+/gi, '\nINNER JOIN ')
    .replace(/WHERE\s+/gi, '\nWHERE ')
    .replace(/AND\s+/gi, '\n  AND ')
    .replace(/OR\s+/gi, '\n  OR ')
    .replace(/ORDER BY\s+/gi, '\nORDER BY ')
    .replace(/LIMIT\s+/gi, '\nLIMIT ')
    .replace(/OFFSET\s+/gi, '\nOFFSET ')
    .replace(/INSERT INTO\s+/gi, '\nINSERT INTO ')
    .replace(/VALUES\s+/gi, '\nVALUES ')
    .replace(/UPDATE\s+/gi, '\nUPDATE ')
    .replace(/SET\s+/gi, '\nSET ')
    .replace(/DELETE FROM\s+/gi, '\nDELETE FROM ')
    .replace(/\s+/g, ' ');

  const lines = formatted.split('\n');
  return lines.map((line, index) => (index === 0 ? line.trim() : '  ' + line.trim())).join('\n');
};

import { Logger } from 'typeorm';

class TypeOrmLogger implements Logger {
  logQuery(query: string) {
    const formattedSql = formatSql(query);
    console.log(`\x1b[36m[TypeORM]\x1b[0m Query:\n${formattedSql}\n`);
  }

  logQueryError(error: string | Error, query: string) {
    const formattedSql = formatSql(query);
    const errorMsg = error instanceof Error ? error.message : error;
    console.error(`\x1b[31m[TypeORM]\x1b[0m Query Error:\n${formattedSql}\n\x1b[31mError: ${errorMsg}\x1b[0m\n`);
  }

  logQuerySlow(time: number, query: string) {
    const formattedSql = formatSql(query);
    console.warn(`\x1b[33m[TypeORM]\x1b[0m Slow Query (${time}ms):\n${formattedSql}\n`);
  }

  logSchemaBuild(message: string) {
    console.log(`\x1b[35m[TypeORM]\x1b[0m Schema Build: ${message}`);
  }

  logMigration(message: string) {
    console.log(`\x1b[35m[TypeORM]\x1b[0m Migration: ${message}`);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown) {
    const colors = {
      log: '\x1b[37m',
      info: '\x1b[34m',
      warn: '\x1b[33m',
    };
    const messageStr = typeof message === 'string' ? message : String(message);
    console.log(`${colors[level]}[TypeORM]\x1b[0m ${messageStr}`);
  }
}

export const typeOrmConfig = (configService: ConfigService): TypeOrmModuleOptions => {
  const env = configService.get<string>('NODE_ENV');
  const loggingEnabled = configService.get<string>('TYPEORM_LOGGING') === 'true' && env !== 'production';
  const loggingType = configService.get<string>('TYPEORM_LOGGING_TYPE', 'pretty');

  const logging: boolean | 'all' = loggingEnabled ? 'all' : false;
  const logger = loggingEnabled && loggingType === 'pretty' ? new TypeOrmLogger() : undefined;

  return {
    type: 'postgres',
    host: configService.get<string>('POSTGRES_HOST', 'localhost'),
    port: configService.get<number>('POSTGRES_PORT', 5432),
    username: configService.get<string>('POSTGRES_USER', 'admin'),
    password: configService.get<string>('POSTGRES_PASSWORD', 'password'),
    database: configService.get<string>('POSTGRES_DB', 'knowledge_doc'),
    entities: [Document, Chunk, Conversation, Message, GraphRun],
    migrations: [__dirname + '/../migrations/**/*{.ts,.js}'],
    migrationsRun: env === 'production' && configService.get<string>('TYPEORM_MIGRATIONS_RUN', 'true') !== 'false',
    synchronize: env !== 'production',
    logging,
    logger,
  };
};
