/**
 * Utility for conditional logging based on environment and debug flags
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
  prefix?: string;
}

// Get environment variables safely for browser environment
const getEnv = () => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env;
  }
  return {
    NODE_ENV: 'development',
    ENZO_DEBUG: '',
    ENZO_LOG_LEVEL: 'info',
  };
};

class Logger {
  private config: LoggerConfig;

  constructor(prefix?: string) {
    const env = getEnv();
    this.config = {
      enabled: env.NODE_ENV === 'development' || !!env.ENZO_DEBUG,
      level: (env.ENZO_LOG_LEVEL as LogLevel) || 'info',
      prefix,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    
    const levels: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
    };

    return levels[level] <= levels[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): [string, ...any[]] {
    const timestamp = new Date().toISOString();
    const prefix = this.config.prefix ? `[${this.config.prefix}]` : '';
    const levelTag = `[${level.toUpperCase()}]`;
    
    return [`${timestamp} ${prefix} ${levelTag} ${message}`, ...args];
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      const [formattedMsg, ...formattedArgs] = this.formatMessage('error', message, ...args);
      console.error(formattedMsg, ...formattedArgs);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      const [formattedMsg, ...formattedArgs] = this.formatMessage('warn', message, ...args);
      console.warn(formattedMsg, ...formattedArgs);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      const [formattedMsg, ...formattedArgs] = this.formatMessage('info', message, ...args);
      console.log(formattedMsg, ...formattedArgs);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      const [formattedMsg, ...formattedArgs] = this.formatMessage('debug', message, ...args);
      console.log(formattedMsg, ...formattedArgs);
    }
  }
}

// Create specific loggers for different modules
export const chatLogger = new Logger('Chat');
export const configLogger = new Logger('Config');
export const statsLogger = new Logger('Stats');
export const apiLogger = new Logger('API');

// Default logger for general use
export const logger = new Logger();

export default Logger;
