/**
 * Shared Logger Service
 * Provides structured logging across all services
 * Phase 3: Scalability
 */

const pino = require('pino');
const os = require('os');

// Generate instance ID if not provided
const INSTANCE_ID = process.env.INSTANCE_ID || `${os.hostname()}-${process.pid}-${Date.now()}`;

// Create logger with environment-based configuration
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false
    }
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    }
  },
  base: {
    service: 'pa-agent',
    env: process.env.NODE_ENV || 'development',
    instance: INSTANCE_ID
  }
});

// Export logger (pino loggers already have a .child() method)
module.exports = logger;
