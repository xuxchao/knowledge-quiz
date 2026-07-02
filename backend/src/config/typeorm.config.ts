import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const typeOrmConfig = (configService: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('POSTGRES_HOST', 'localhost'),
  port: configService.get<number>('POSTGRES_PORT', 5432),
  username: configService.get<string>('POSTGRES_USER', 'admin'),
  password: configService.get<string>('POSTGRES_PASSWORD', 'password'),
  database: configService.get<string>('POSTGRES_DB', 'knowledge_doc'),
  entities: [__dirname + '/../entities/**/*.entity.ts'],
  migrations: [__dirname + '/../migrations/**/*.ts'],
  synchronize: configService.get<string>('NODE_ENV') !== 'production',
  logging: configService.get<string>('NODE_ENV') !== 'production',
});
