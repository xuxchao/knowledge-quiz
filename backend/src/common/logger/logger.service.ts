import { Injectable, LoggerService as NestLoggerService, OnApplicationShutdown } from '@nestjs/common';
import { createLogger, format as winstonFormat, Logger as WinstonLogger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { LogLevel, LogEntry, formatJson, formatConsole, createLogEntry } from './formatters';
import { LoggerConfigRegistry, shouldLog, LoggerConfig, ModuleConfig, FileLoggerConfig } from './logger.config';

const FRAMEWORK_CONTEXTS = [
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
  'InstanceLoader',
  'Injector',
  'ModuleRef',
];

@Injectable()
export class LoggerService implements NestLoggerService, OnApplicationShutdown {
  private static globalConfigRegistry: LoggerConfigRegistry | null = null;
  private static fileLogger: WinstonLogger | null = null;
  private static fileLoggerConfigKey: string | null = null;

  private configRegistry: LoggerConfigRegistry;
  private moduleName: string;

  constructor(context?: string) {
    this.moduleName = context || 'Global';
    this.configRegistry = LoggerService.globalConfigRegistry || new LoggerConfigRegistry();
  }

  static setGlobalConfigRegistry(registry: LoggerConfigRegistry): void {
    LoggerService.closeFileLogger();
    LoggerService.globalConfigRegistry = registry;
  }

  static getGlobalConfigRegistry(): LoggerConfigRegistry | null {
    return LoggerService.globalConfigRegistry;
  }

  setConfigRegistry(registry: LoggerConfigRegistry): void {
    this.configRegistry = registry;
  }

  getConfigRegistry(): LoggerConfigRegistry {
    return this.configRegistry;
  }

  onApplicationShutdown(): void {
    LoggerService.closeFileLogger();
  }

  debug(message: string, context?: string): void {
    this.writeLog(message, 'DEBUG', context);
  }

  info(message: string, context?: string): void {
    this.writeLog(message, 'INFO', context);
  }

  log(message: string, context?: string): void {
    this.writeLog(message, 'INFO', context);
  }

  warn(message: string, context?: string): void {
    this.writeLog(message, 'WARN', context);
  }

  error(message: string, stack?: string, context?: string): void {
    this.writeLog(message, 'ERROR', context, stack);
  }

  verbose(message: string, context?: string): void {
    this.writeLog(message, 'DEBUG', context);
  }

  private writeLog(message: string, level: LogLevel, context?: string, stackTrace?: string): void {
    const moduleName = context || this.moduleName;

    const isFrameworkLog = FRAMEWORK_CONTEXTS.includes(moduleName);
    if (!this.configRegistry.isModuleEnabled(moduleName)) {
      return;
    }

    if (isFrameworkLog && this.configRegistry.getGlobalLevel() !== 'DEBUG') {
      return;
    }

    const moduleLevel = this.configRegistry.getModuleLevel(moduleName);
    if (!shouldLog(level, moduleLevel)) {
      return;
    }

    const entry = createLogEntry(level, moduleName, message, undefined, stackTrace);

    this.output(entry);
  }

  private output(entry: LogEntry): void {
    const format = this.configRegistry.getOutputFormat();
    const formatted = format === 'json' ? formatJson(entry) : formatConsole(entry);

    switch (entry.level) {
      case 'DEBUG':
        console.debug(formatted);
        break;
      case 'INFO':
        console.log(formatted);
        break;
      case 'WARN':
        console.warn(formatted);
        break;
      case 'ERROR':
        console.error(formatted);
        break;
    }

    const fileLogger = LoggerService.getFileLogger(this.configRegistry.getFileConfig());
    fileLogger?.log(entry.level.toLowerCase(), formatJson(entry));
  }

  private static getFileLogger(config: FileLoggerConfig): WinstonLogger | null {
    if (!config.enabled) {
      return null;
    }

    const configKey = JSON.stringify(config);
    if (LoggerService.fileLogger && LoggerService.fileLoggerConfigKey === configKey) {
      return LoggerService.fileLogger;
    }

    LoggerService.closeFileLogger();

    const transportOptions = {
      dirname: config.directory,
      datePattern: config.datePattern,
      maxSize: config.maxSize,
      maxFiles: config.maxFiles,
      zippedArchive: true,
    };

    LoggerService.fileLogger = createLogger({
      level: 'debug',
      format: winstonFormat.printf(({ message }) => String(message)),
      transports: [
        new DailyRotateFile({
          ...transportOptions,
          filename: config.filename,
        }),
        new DailyRotateFile({
          ...transportOptions,
          level: 'error',
          filename: config.errorFilename,
        }),
      ],
    });
    LoggerService.fileLogger.on('error', (error: Error) => {
      console.error(`文件日志写入失败: ${error.message}`);
    });
    LoggerService.fileLoggerConfigKey = configKey;

    return LoggerService.fileLogger;
  }

  private static closeFileLogger(): void {
    LoggerService.fileLogger?.close();
    LoggerService.fileLogger = null;
    LoggerService.fileLoggerConfigKey = null;
  }

  step<T>(stepName: string, fn: () => T): T {
    this.debug(`步骤开始 - ${stepName}`);
    const startTime = Date.now();

    try {
      const result = fn();
      const duration = Date.now() - startTime;
      this.debug(`步骤成功完成 - ${stepName}，耗时: ${duration}ms`);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.error(`步骤执行失败 - ${stepName}，耗时: ${duration}ms，错误: ${errorMessage}`, stackTrace);
      throw error;
    }
  }

  async stepAsync<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
    this.debug(`步骤开始 - ${stepName}`);
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.debug(`步骤成功完成 - ${stepName}，耗时: ${duration}ms`);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.error(`步骤执行失败 - ${stepName}，耗时: ${duration}ms，错误: ${errorMessage}`, stackTrace);
      throw error;
    }
  }

  async serviceCall<T>(serviceName: string, methodName: string, fn: () => Promise<T>): Promise<T> {
    const fullName = `${serviceName}.${methodName}`;
    this.debug(`服务调用开始 - ${fullName}`);
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.debug(`服务调用成功 - ${fullName}，耗时: ${duration}ms`);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.error(`服务调用异常 - ${fullName}，耗时: ${duration}ms，错误: ${errorMessage}`, stackTrace);
      throw error;
    }
  }

  enableModule(moduleName: string): void {
    this.configRegistry.enableModule(moduleName);
    this.info(`模块日志已启用 - ${moduleName}`);
  }

  disableModule(moduleName: string): void {
    this.configRegistry.disableModule(moduleName);
    this.info(`模块日志已禁用 - ${moduleName}`);
  }

  setModuleLevel(moduleName: string, level: LogLevel): void {
    this.configRegistry.setModuleLevel(moduleName, level);
    this.info(`模块日志级别已更改 - ${moduleName}，新级别: ${level}`);
  }

  setGlobalLevel(level: LogLevel): void {
    this.configRegistry.setGlobalLevel(level);
    this.info(`全局日志级别已设置为: ${level}`);
  }

  setOutputFormat(format: 'console' | 'json'): void {
    this.configRegistry.setOutputFormat(format);
    this.info(`日志输出格式已更改为: ${format}`);
  }

  getModuleConfig(moduleName: string): ModuleConfig {
    return this.configRegistry.getModuleConfig(moduleName);
  }

  getConfig(): LoggerConfig {
    return this.configRegistry.getConfig();
  }
}
