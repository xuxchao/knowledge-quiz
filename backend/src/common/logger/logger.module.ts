import { Module, Global } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { LoggerConfigRegistry, LoggerConfig } from './logger.config';

export interface LoggerModuleOptions {
  config?: Partial<LoggerConfig>;
}

@Global()
@Module({
  providers: [
    LoggerConfigRegistry,
    {
      provide: LoggerService,
      useFactory: (configRegistry: LoggerConfigRegistry) => {
        const logger = new LoggerService('LoggerModule');
        logger.setConfigRegistry(configRegistry);
        return logger;
      },
      inject: [LoggerConfigRegistry],
    },
  ],
  exports: [LoggerService, LoggerConfigRegistry],
})
export class LoggerModule {
  static forRoot(options?: LoggerModuleOptions) {
    return {
      module: LoggerModule,
      providers: [
        {
          provide: LoggerConfigRegistry,
          useValue: new LoggerConfigRegistry(options?.config),
        },
        {
          provide: LoggerService,
          useFactory: (configRegistry: LoggerConfigRegistry) => {
            const logger = new LoggerService('LoggerModule');
            logger.setConfigRegistry(configRegistry);
            return logger;
          },
          inject: [LoggerConfigRegistry],
        },
      ],
      exports: [LoggerService, LoggerConfigRegistry],
    };
  }
}