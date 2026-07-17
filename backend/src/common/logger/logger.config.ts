import { LogLevel } from './formatters';

export interface ModuleConfig {
  enabled: boolean;
  level: LogLevel;
}

export interface FileLoggerConfig {
  enabled: boolean;
  directory: string;
  filename: string;
  errorFilename: string;
  datePattern: string;
  maxSize: string;
  maxFiles: string;
}

export interface LoggerConfig {
  globalLevel: LogLevel;
  globalEnabled: boolean;
  modules: Record<string, ModuleConfig>;
  outputFormat: 'console' | 'json';
  file: FileLoggerConfig;
}

export type LoggerConfigOptions = Omit<Partial<LoggerConfig>, 'file'> & {
  file?: Partial<FileLoggerConfig>;
};

export const DEFAULT_CONFIG: LoggerConfig = {
  globalLevel: 'INFO',
  globalEnabled: true,
  modules: {},
  outputFormat: 'console',
  file: {
    enabled: false,
    directory: 'logs',
    filename: 'backend-%DATE%.log',
    errorFilename: 'backend-error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
  },
};

export class LoggerConfigRegistry {
  private config: LoggerConfig;

  constructor(config: LoggerConfigOptions = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      modules: { ...DEFAULT_CONFIG.modules, ...config.modules },
      file: { ...DEFAULT_CONFIG.file, ...config.file },
    };
  }

  getModuleConfig(moduleName: string): ModuleConfig {
    if (this.config.modules[moduleName]) {
      return this.config.modules[moduleName];
    }
    return {
      enabled: this.config.globalEnabled,
      level: this.config.globalLevel,
    };
  }

  setModuleConfig(moduleName: string, config: Partial<ModuleConfig>): void {
    const existing = this.getModuleConfig(moduleName);
    this.config.modules[moduleName] = { ...existing, ...config };
  }

  enableModule(moduleName: string): void {
    this.setModuleConfig(moduleName, { enabled: true });
  }

  disableModule(moduleName: string): void {
    this.setModuleConfig(moduleName, { enabled: false });
  }

  setModuleLevel(moduleName: string, level: LogLevel): void {
    this.setModuleConfig(moduleName, { level });
  }

  isModuleEnabled(moduleName: string): boolean {
    return this.getModuleConfig(moduleName).enabled;
  }

  getModuleLevel(moduleName: string): LogLevel {
    return this.getModuleConfig(moduleName).level;
  }

  getGlobalLevel(): LogLevel {
    return this.config.globalLevel;
  }

  setGlobalLevel(level: LogLevel): void {
    this.config.globalLevel = level;
  }

  isGlobalEnabled(): boolean {
    return this.config.globalEnabled;
  }

  setGlobalEnabled(enabled: boolean): void {
    this.config.globalEnabled = enabled;
  }

  getOutputFormat(): 'console' | 'json' {
    return this.config.outputFormat;
  }

  getFileConfig(): FileLoggerConfig {
    return { ...this.config.file };
  }

  setOutputFormat(format: 'console' | 'json'): void {
    this.config.outputFormat = format;
  }

  getConfig(): LoggerConfig {
    return {
      ...this.config,
      modules: { ...this.config.modules },
      file: { ...this.config.file },
    };
  }
}

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export function shouldLog(level: LogLevel, moduleLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[moduleLevel];
}
