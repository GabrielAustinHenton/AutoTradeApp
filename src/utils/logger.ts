type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  maxStoredLogs: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '#9ca3af',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
};

class Logger {
  private config: LoggerConfig = {
    enabled: true,
    minLevel: import.meta.env.DEV ? 'debug' : 'info',
    maxStoredLogs: 100,
  };

  private logs: LogEntry[] = [];

  private shouldLog(level: LogLevel): boolean {
    return this.config.enabled && LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(category: string, message: string): string {
    const timestamp = new Date().toLocaleTimeString();
    return `[${timestamp}] [${category}] ${message}`;
  }

  private log(level: LogLevel, category: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      data,
    };

    // Store log entry
    this.logs.push(entry);
    if (this.logs.length > this.config.maxStoredLogs) {
      this.logs.shift();
    }

    // Console output
    const formattedMessage = this.formatMessage(category, message);
    const style = `color: ${LOG_COLORS[level]}; font-weight: bold;`;

    switch (level) {
      case 'debug':
        if (data !== undefined) {
          console.debug(`%c${formattedMessage}`, style, data);
        } else {
          console.debug(`%c${formattedMessage}`, style);
        }
        break;
      case 'info':
        if (data !== undefined) {
          console.info(`%c${formattedMessage}`, style, data);
        } else {
          console.info(`%c${formattedMessage}`, style);
        }
        break;
      case 'warn':
        if (data !== undefined) {
          console.warn(`%c${formattedMessage}`, style, data);
        } else {
          console.warn(`%c${formattedMessage}`, style);
        }
        break;
      case 'error':
        if (data !== undefined) {
          console.error(`%c${formattedMessage}`, style, data);
        } else {
          console.error(`%c${formattedMessage}`, style);
        }
        break;
    }
  }

  debug(category: string, message: string, data?: unknown): void {
    this.log('debug', category, message, data);
  }

  info(category: string, message: string, data?: unknown): void {
    this.log('info', category, message, data);
  }

  warn(category: string, message: string, data?: unknown): void {
    this.log('warn', category, message, data);
  }

  error(category: string, message: string, data?: unknown): void {
    this.log('error', category, message, data);
  }

  // Get stored logs for debugging
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // Get logs filtered by level
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  // Get logs filtered by category
  getLogsByCategory(category: string): LogEntry[] {
    return this.logs.filter((log) => log.category === category);
  }

  // Clear stored logs
  clearLogs(): void {
    this.logs = [];
  }

  // Update configuration
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Disable logging
  disable(): void {
    this.config.enabled = false;
  }

  // Enable logging
  enable(): void {
    this.config.enabled = true;
  }
}

// Singleton instance
export const logger = new Logger();

// Convenience functions for common categories
export const log = {
  api: (message: string, data?: unknown) => logger.info('API', message, data),
  trade: (message: string, data?: unknown) => logger.info('Trade', message, data),
  portfolio: (message: string, data?: unknown) => logger.info('Portfolio', message, data),
  pattern: (message: string, data?: unknown) => logger.info('Pattern', message, data),
  backtest: (message: string, data?: unknown) => logger.info('Backtest', message, data),
  store: (message: string, data?: unknown) => logger.debug('Store', message, data),
  error: (category: string, message: string, data?: unknown) => logger.error(category, message, data),
};
