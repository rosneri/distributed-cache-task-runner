const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

let configuredLevel: LogLevel = 'info';

/** Set the level from config. `DCACHE_LOG_LEVEL` still takes precedence. */
export function setLogLevel(level: LogLevel): void {
  configuredLevel = level;
}

function getLogLevel(): LogLevel {
  const env = process.env['DCACHE_LOG_LEVEL']?.toLowerCase();
  if (env && env in LOG_LEVELS) {
    return env as LogLevel;
  }
  return configuredLevel;
}

function shouldLog(messageLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[getLogLevel()];
}

function formatMessage(level: LogLevel, message: string): string {
  return `[dcache:${level}] ${message}`;
}

export const logger = {
  debug(message: string): void {
    if (shouldLog('debug')) {
      process.stderr.write(formatMessage('debug', message) + '\n');
    }
  },

  info(message: string): void {
    if (shouldLog('info')) {
      process.stderr.write(formatMessage('info', message) + '\n');
    }
  },

  warn(message: string): void {
    if (shouldLog('warn')) {
      process.stderr.write(formatMessage('warn', message) + '\n');
    }
  },

  error(message: string): void {
    if (shouldLog('error')) {
      process.stderr.write(formatMessage('error', message) + '\n');
    }
  },
} as const;

export type { LogLevel };
