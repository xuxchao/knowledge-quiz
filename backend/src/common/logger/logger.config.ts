import { LogLevel } from './formatters';

export interface ModuleConfig {
  enabled: boolean;
  level: LogLevel;
}

export interface LoggerConfig {
  globalLevel: LogLevel;
  globalEnabled: boolean;
  modules: Record<string, ModuleConfig>;
  outputFormat: 'console' | 'json';
}

export const DEFAULT_CONFIG: LoggerConfig = {
  globalLevel: 'INFO',
  globalEnabled: true,
  modules: {},
  outputFormat: 'console',
};

export class LoggerConfigRegistry {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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

  setOutputFormat(format: 'console' | 'json'): void {
    this.config.outputFormat = format;
  }

  getConfig(): LoggerConfig {
    return { ...this.config };
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
