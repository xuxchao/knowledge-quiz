import { Module, Global } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { LoggerConfigRegistry, LoggerConfigOptions } from './logger.config';

export interface LoggerModuleOptions {
  config?: LoggerConfigOptions;
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
    const configRegistry = new LoggerConfigRegistry(options?.config);
    LoggerService.setGlobalConfigRegistry(configRegistry);

    return {
      module: LoggerModule,
      providers: [
        {
          provide: LoggerConfigRegistry,
          useValue: configRegistry,
        },
        {
          provide: LoggerService,
          useFactory: (registry: LoggerConfigRegistry) => {
            const logger = new LoggerService('LoggerModule');
            logger.setConfigRegistry(registry);
            return logger;
          },
          inject: [LoggerConfigRegistry],
        },
      ],
      exports: [LoggerService, LoggerConfigRegistry],
    };
  }
}
