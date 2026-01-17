const promClient = require('prom-client');

// Error categories
const ERROR_CATEGORIES = {
  CONNECTION: 'connection',
  DATABASE: 'database',
  MESSAGE: 'message',
  CACHE: 'cache',
  SECURITY: 'security',
  VALIDATION: 'validation',
  NETWORK: 'network',
  UNKNOWN: 'unknown'
};

// Error severity levels
const ERROR_SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

// Error metrics
const errorRateCounter = new promClient.Counter({
  name: 'pa_agent_error_rate_total',
  help: 'Total errors by category and severity',
  labelNames: ['category', 'severity', 'error_type']
});

const errorPatternGauge = new promClient.Gauge({
  name: 'pa_agent_error_pattern_count',
  help: 'Repeated error pattern count',
  labelNames: ['pattern_hash']
});

class ErrorTracker {
  constructor(logger) {
    this.logger = logger;
    this.errorHistory = [];
    this.errorPatterns = new Map();
    this.maxHistorySize = 1000;
    this.patternThreshold = 5; // Report pattern if error occurs 5+ times
  }

  // Categorize error
  categorizeError(error) {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('connection') || message.includes('socket') || message.includes('disconnect')) {
      return ERROR_CATEGORIES.CONNECTION;
    }
    if (message.includes('database') || message.includes('query') || message.includes('supabase')) {
      return ERROR_CATEGORIES.DATABASE;
    }
    if (message.includes('message') || message.includes('send') || message.includes('receive')) {
      return ERROR_CATEGORIES.MESSAGE;
    }
    if (message.includes('cache') || message.includes('redis')) {
      return ERROR_CATEGORIES.CACHE;
    }
    if (message.includes('encrypt') || message.includes('decrypt') || message.includes('auth')) {
      return ERROR_CATEGORIES.SECURITY;
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return ERROR_CATEGORIES.VALIDATION;
    }
    if (message.includes('network') || message.includes('timeout') || message.includes('econnrefused')) {
      return ERROR_CATEGORIES.NETWORK;
    }
    
    return ERROR_CATEGORIES.UNKNOWN;
  }

  // Determine error severity
  determineSeverity(error, category) {
    const message = error.message?.toLowerCase() || '';
    
    // Critical errors
    if (category === ERROR_CATEGORIES.SECURITY) return ERROR_SEVERITY.CRITICAL;
    if (message.includes('fatal') || message.includes('crash')) return ERROR_SEVERITY.CRITICAL;
    
    // High severity
    if (category === ERROR_CATEGORIES.DATABASE) return ERROR_SEVERITY.HIGH;
    if (category === ERROR_CATEGORIES.CONNECTION && message.includes('failed')) return ERROR_SEVERITY.HIGH;
    
    // Medium severity
    if (category === ERROR_CATEGORIES.MESSAGE) return ERROR_SEVERITY.MEDIUM;
    if (category === ERROR_CATEGORIES.CACHE) return ERROR_SEVERITY.MEDIUM;
    
    // Low severity
    return ERROR_SEVERITY.LOW;
  }

  // Generate error signature for pattern detection
  generateSignature(error, category) {
    const message = error.message || 'unknown';
    const stack = error.stack?.split('\n')[1] || ''; // First stack frame
    return `${category}:${message}:${stack}`;
  }

  // Track error
  trackError(error, context = {}) {
    try {
      const category = this.categorizeError(error);
      const severity = this.determineSeverity(error, category);
      const signature = this.generateSignature(error, category);
      const timestamp = Date.now();

      // Record error
      const errorRecord = {
        timestamp,
        category,
        severity,
        message: error.message,
        stack: error.stack,
        signature,
        context
      };

      // Add to history
      this.errorHistory.push(errorRecord);
      if (this.errorHistory.length > this.maxHistorySize) {
        this.errorHistory.shift();
      }

      // Track pattern
      if (!this.errorPatterns.has(signature)) {
        this.errorPatterns.set(signature, {
          count: 0,
          firstSeen: timestamp,
          lastSeen: timestamp,
          category,
          severity,
          message: error.message
        });
      }

      const pattern = this.errorPatterns.get(signature);
      pattern.count++;
      pattern.lastSeen = timestamp;

      // Update metrics
      errorRateCounter.labels(category, severity, error.name || 'Error').inc();
      errorPatternGauge.labels(signature.substring(0, 64)).set(pattern.count);

      // Log error
      const logData = {
        category,
        severity,
        message: error.message,
        patternCount: pattern.count,
        ...context
      };

      if (severity === ERROR_SEVERITY.CRITICAL) {
        this.logger.error(logData, 'Critical error tracked');
      } else if (severity === ERROR_SEVERITY.HIGH) {
        this.logger.error(logData, 'High severity error tracked');
      } else {
        this.logger.warn(logData, 'Error tracked');
      }

      // Detect pattern
      if (pattern.count >= this.patternThreshold && pattern.count % this.patternThreshold === 0) {
        this.logger.warn({
          pattern: signature.substring(0, 100),
          count: pattern.count,
          firstSeen: new Date(pattern.firstSeen).toISOString(),
          lastSeen: new Date(pattern.lastSeen).toISOString(),
          category,
          severity
        }, 'Error pattern detected');
      }

      return errorRecord;
    } catch (trackingError) {
      this.logger.error({ error: trackingError.message }, 'Failed to track error');
      return null;
    }
  }

  // Get error statistics
  getErrorStats(timeWindowMs = 3600000) { // Default: 1 hour
    const cutoff = Date.now() - timeWindowMs;
    const recentErrors = this.errorHistory.filter(e => e.timestamp > cutoff);

    const stats = {
      total: recentErrors.length,
      byCategory: {},
      bySeverity: {},
      topPatterns: []
    };

    // Count by category
    recentErrors.forEach(error => {
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    // Get top patterns
    const patternArray = Array.from(this.errorPatterns.entries())
      .map(([signature, data]) => ({
        signature: signature.substring(0, 100),
        ...data
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    stats.topPatterns = patternArray;

    return stats;
  }

  // Get error rate (errors per minute)
  getErrorRate(timeWindowMs = 300000) { // Default: 5 minutes
    const cutoff = Date.now() - timeWindowMs;
    const recentErrors = this.errorHistory.filter(e => e.timestamp > cutoff);
    const minutes = timeWindowMs / 60000;
    return (recentErrors.length / minutes).toFixed(2);
  }

  // Clear old patterns
  clearOldPatterns(maxAgeMs = 86400000) { // Default: 24 hours
    const cutoff = Date.now() - maxAgeMs;
    for (const [signature, pattern] of this.errorPatterns.entries()) {
      if (pattern.lastSeen < cutoff) {
        this.errorPatterns.delete(signature);
      }
    }
  }

  // Start pattern cleanup
  startPatternCleanup(intervalMs = 3600000) { // Default: 1 hour
    setInterval(() => {
      this.clearOldPatterns();
      this.logger.info({
        activePatterns: this.errorPatterns.size,
        historySize: this.errorHistory.length
      }, 'Error pattern cleanup completed');
    }, intervalMs);
  }
}

module.exports = {
  ErrorTracker,
  ERROR_CATEGORIES,
  ERROR_SEVERITY,
  errorRateCounter,
  errorPatternGauge
};
