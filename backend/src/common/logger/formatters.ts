import { LOG_LEVEL_DESCRIPTIONS } from './messages';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelDescription: string;
  module: string;
  message: string;
  context?: Record<string, unknown>;
  stackTrace?: string;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[36m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
};

const RESET_COLOR = '\x1b[0m';

export function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry, null, 2);
}

export function formatConsole(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const timestamp = `[${entry.timestamp}]`;
  const level = `${color}[${entry.level}]${RESET_COLOR}`;
  const module = `[${entry.module}]`;

  let output = `${timestamp} ${level} ${module} - ${entry.message}`;

  if (entry.stackTrace) {
    output += `\n堆栈跟踪:\n${entry.stackTrace}`;
  }

  if (entry.context && Object.keys(entry.context).length > 0) {
    output += `\n上下文: ${JSON.stringify(entry.context)}`;
  }

  return output;
}

export function createLogEntry(
  level: LogLevel,
  module: string,
  message: string,
  context?: Record<string, unknown>,
  stackTrace?: string,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    levelDescription: LOG_LEVEL_DESCRIPTIONS[level],
    module,
    message,
    context,
    stackTrace,
  };
}
