import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { LoggerService, LogServiceCall } from '../common/logger';

@Injectable()
export class GraphCheckpointService implements OnModuleDestroy {
  private readonly logger = new LoggerService(GraphCheckpointService.name);
  private checkpointer?: PostgresSaver;
  private initialization?: Promise<PostgresSaver>;

  constructor(private readonly configService: ConfigService) {}

  @LogServiceCall()
  get(): Promise<PostgresSaver> {
    if (!this.initialization) this.initialization = this.initialize();
    return this.initialization;
  }

  @LogServiceCall()
  async onModuleDestroy(): Promise<void> {
    if (this.checkpointer) await this.checkpointer.end();
  }

  private async initialize(): Promise<PostgresSaver> {
    const username = encodeURIComponent(this.configService.get<string>('POSTGRES_USER', 'admin'));
    const password = encodeURIComponent(this.configService.get<string>('POSTGRES_PASSWORD', 'password'));
    const host = this.configService.get<string>('POSTGRES_HOST', 'localhost');
    const port = this.configService.get<number>('POSTGRES_PORT', 5432);
    const database = encodeURIComponent(this.configService.get<string>('POSTGRES_DB', 'knowledge_doc'));
    const connectionString = `postgresql://${username}:${password}@${host}:${port}/${database}`;
    this.checkpointer = PostgresSaver.fromConnString(connectionString, { schema: 'langgraph' });
    await this.checkpointer.setup();
    this.logger.info('LangGraph PostgreSQL checkpoint初始化完成');
    return this.checkpointer;
  }
}
