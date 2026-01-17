const EventEmitter = require('events');

// Alert severity levels
const ALERT_SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info'
};

// Alert types
const ALERT_TYPES = {
  CONNECTION_FAILURE_RATE: 'connection_failure_rate',
  DATABASE_ERROR_RATE: 'database_error_rate',
  MEMORY_USAGE: 'memory_usage',
  CACHE_HIT_RATE: 'cache_hit_rate',
  MESSAGE_QUEUE_BACKLOG: 'message_queue_backlog',
  HEALTH_CHECK_FAILURE: 'health_check_failure',
  INSTANCE_COORDINATION_FAILURE: 'instance_coordination_failure',
  PERFORMANCE_DEGRADATION: 'performance_degradation',
  ERROR_PATTERN: 'error_pattern'
};

// Alerting rules configuration
const ALERTING_RULES = {
  connectionFailureRate: {
    threshold: 10, // percentage
    windowMs: 300000, // 5 minutes
    severity: ALERT_SEVERITY.CRITICAL
  },
  databaseErrorRate: {
    threshold: 50, // errors per minute
    windowMs: 60000, // 1 minute
    severity: ALERT_SEVERITY.CRITICAL
  },
  memoryUsage: {
    threshold: 90, // percentage
    windowMs: 60000, // 1 minute
    severity: ALERT_SEVERITY.CRITICAL
  },
  cacheHitRate: {
    threshold: 50, // percentage
    windowMs: 600000, // 10 minutes
    severity: ALERT_SEVERITY.WARNING
  },
  messageQueueBacklog: {
    threshold: 1000, // messages
    windowMs: 300000, // 5 minutes
    severity: ALERT_SEVERITY.WARNING
  },
  performanceDegradation: {
    threshold: 2, // 2x slower
    windowMs: 600000, // 10 minutes
    severity: ALERT_SEVERITY.WARNING
  }
};

class AlertingService extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.maxHistorySize = 1000;
    this.cooldownPeriod = 300000; // 5 minutes - prevent alert spam
  }

  // Check if alert should be suppressed (cooldown)
  shouldSuppress(alertType, alertKey) {
    const key = `${alertType}:${alertKey}`;
    const existing = this.activeAlerts.get(key);
    
    if (!existing) return false;
    
    const timeSinceLastAlert = Date.now() - existing.lastTriggered;
    return timeSinceLastAlert < this.cooldownPeriod;
  }

  // Trigger alert
  triggerAlert(alertType, severity, message, metadata = {}) {
    try {
      const alertKey = metadata.alertKey || 'default';
      const key = `${alertType}:${alertKey}`;

      // Check cooldown
      if (this.shouldSuppress(alertType, alertKey)) {
        this.logger.debug({
          alertType,
          alertKey,
          message
        }, 'Alert suppressed (cooldown period)');
        return null;
      }

      // Create alert
      const alert = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: alertType,
        severity,
        message,
        metadata,
        timestamp: new Date().toISOString(),
        timestampMs: Date.now()
      };

      // Update active alerts
      this.activeAlerts.set(key, {
        alert,
        lastTriggered: Date.now(),
        count: (this.activeAlerts.get(key)?.count || 0) + 1
      });

      // Add to history
      this.alertHistory.push(alert);
      if (this.alertHistory.length > this.maxHistorySize) {
        this.alertHistory.shift();
      }

      // Log alert
      const logData = {
        alertType,
        severity,
        message,
        ...metadata
      };

      if (severity === ALERT_SEVERITY.CRITICAL) {
        this.logger.error(logData, '🚨 CRITICAL ALERT');
      } else if (severity === ALERT_SEVERITY.WARNING) {
        this.logger.warn(logData, '⚠️  WARNING ALERT');
      } else {
        this.logger.info(logData, 'ℹ️  INFO ALERT');
      }

      // Emit alert event (for external integrations)
      this.emit('alert', alert);

      return alert;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to trigger alert');
      return null;
    }
  }

  // Resolve alert
  resolveAlert(alertType, alertKey = 'default') {
    const key = `${alertType}:${alertKey}`;
    const existing = this.activeAlerts.get(key);

    if (existing) {
      this.activeAlerts.delete(key);
      
      this.logger.info({
        alertType,
        alertKey,
        duration: Date.now() - existing.lastTriggered
      }, '✅ Alert resolved');

      this.emit('alert:resolved', { type: alertType, key: alertKey });
    }
  }

  // Check connection failure rate
  checkConnectionFailureRate(failureCount, totalCount) {
    if (totalCount === 0) return;

    const failureRate = (failureCount / totalCount) * 100;
    const rule = ALERTING_RULES.connectionFailureRate;

    if (failureRate > rule.threshold) {
      this.triggerAlert(
        ALERT_TYPES.CONNECTION_FAILURE_RATE,
        rule.severity,
        `Connection failure rate is ${failureRate.toFixed(1)}% (threshold: ${rule.threshold}%)`,
        {
          failureRate: failureRate.toFixed(1),
          threshold: rule.threshold,
          failureCount,
          totalCount,
          alertKey: 'connection_failure'
        }
      );
    } else {
      this.resolveAlert(ALERT_TYPES.CONNECTION_FAILURE_RATE, 'connection_failure');
    }
  }

  // Check database error rate
  checkDatabaseErrorRate(errorCount, windowMs) {
    const rule = ALERTING_RULES.databaseErrorRate;
    const errorsPerMinute = (errorCount / (windowMs / 60000));

    if (errorsPerMinute > rule.threshold) {
      this.triggerAlert(
        ALERT_TYPES.DATABASE_ERROR_RATE,
        rule.severity,
        `Database error rate is ${errorsPerMinute.toFixed(1)}/min (threshold: ${rule.threshold}/min)`,
        {
          errorRate: errorsPerMinute.toFixed(1),
          threshold: rule.threshold,
          errorCount,
          alertKey: 'db_errors'
        }
      );
    } else {
      this.resolveAlert(ALERT_TYPES.DATABASE_ERROR_RATE, 'db_errors');
    }
  }

  // Check memory usage
  checkMemoryUsage(usagePercent) {
    const rule = ALERTING_RULES.memoryUsage;

    if (usagePercent > rule.threshold) {
      this.triggerAlert(
        ALERT_TYPES.MEMORY_USAGE,
        rule.severity,
        `Memory usage is ${usagePercent.toFixed(1)}% (threshold: ${rule.threshold}%)`,
        {
          usagePercent: usagePercent.toFixed(1),
          threshold: rule.threshold,
          alertKey: 'memory'
        }
      );
    } else {
      this.resolveAlert(ALERT_TYPES.MEMORY_USAGE, 'memory');
    }
  }

  // Check cache hit rate
  checkCacheHitRate(hitRate) {
    const rule = ALERTING_RULES.cacheHitRate;

    if (hitRate < rule.threshold) {
      this.triggerAlert(
        ALERT_TYPES.CACHE_HIT_RATE,
        rule.severity,
        `Cache hit rate is ${hitRate.toFixed(1)}% (threshold: ${rule.threshold}%)`,
        {
          hitRate: hitRate.toFixed(1),
          threshold: rule.threshold,
          alertKey: 'cache_hit_rate'
        }
      );
    } else {
      this.resolveAlert(ALERT_TYPES.CACHE_HIT_RATE, 'cache_hit_rate');
    }
  }

  // Check message queue backlog
  checkMessageQueueBacklog(queueSize) {
    const rule = ALERTING_RULES.messageQueueBacklog;

    if (queueSize > rule.threshold) {
      this.triggerAlert(
        ALERT_TYPES.MESSAGE_QUEUE_BACKLOG,
        rule.severity,
        `Message queue backlog is ${queueSize} (threshold: ${rule.threshold})`,
        {
          queueSize,
          threshold: rule.threshold,
          alertKey: 'message_queue'
        }
      );
    } else {
      this.resolveAlert(ALERT_TYPES.MESSAGE_QUEUE_BACKLOG, 'message_queue');
    }
  }

  // Check performance degradation
  checkPerformanceDegradation(currentAvg, baselineAvg, operation) {
    if (!baselineAvg || baselineAvg === 0) return;

    const rule = ALERTING_RULES.performanceDegradation;
    const ratio = currentAvg / baselineAvg;

    if (ratio > rule.threshold) {
      this.triggerAlert(
        ALERT_TYPES.PERFORMANCE_DEGRADATION,
        rule.severity,
        `${operation} is ${ratio.toFixed(1)}x slower than baseline`,
        {
          operation,
          currentAvg: currentAvg.toFixed(2),
          baselineAvg: baselineAvg.toFixed(2),
          ratio: ratio.toFixed(1),
          threshold: rule.threshold,
          alertKey: `perf_${operation}`
        }
      );
    } else {
      this.resolveAlert(ALERT_TYPES.PERFORMANCE_DEGRADATION, `perf_${operation}`);
    }
  }

  // Get alert statistics
  getAlertStats(timeWindowMs = 3600000) { // Default: 1 hour
    const cutoff = Date.now() - timeWindowMs;
    const recentAlerts = this.alertHistory.filter(a => 
      new Date(a.timestamp).getTime() > cutoff
    );

    const stats = {
      total: recentAlerts.length,
      active: this.activeAlerts.size,
      bySeverity: {
        critical: recentAlerts.filter(a => a.severity === ALERT_SEVERITY.CRITICAL).length,
        warning: recentAlerts.filter(a => a.severity === ALERT_SEVERITY.WARNING).length,
        info: recentAlerts.filter(a => a.severity === ALERT_SEVERITY.INFO).length
      },
      byType: {}
    };

    // Count by type
    recentAlerts.forEach(alert => {
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
    });

    // Add active alerts details
    stats.activeAlerts = Array.from(this.activeAlerts.entries()).map(([key, data]) => ({
      key,
      type: data.alert.type,
      severity: data.alert.severity,
      message: data.alert.message,
      count: data.count,
      lastTriggered: new Date(data.lastTriggered).toISOString()
    }));

    return stats;
  }

  // Start periodic monitoring
  startMonitoring(baileysService, intervalMs = 60000) { // Default: 1 minute
    setInterval(() => {
      try {
        // Get current metrics
        const health = baileysService.getInstanceHealth();
        const errorStats = baileysService.errorTracker?.getErrorStats(300000);
        
        // Check database error rate
        if (errorStats?.byCategory?.database) {
          this.checkDatabaseErrorRate(errorStats.byCategory.database, 300000);
        }
        
        // Check memory usage
        const memUsage = process.memoryUsage();
        const memLimit = 2 * 1024 * 1024 * 1024; // 2GB
        const memPercent = (memUsage.heapUsed / memLimit) * 100;
        this.checkMemoryUsage(memPercent);
        
        // Check cache hit rate
        if (health.localCaches) {
          const cacheHitRate = this.calculateCacheHitRate(health.localCaches);
          this.checkCacheHitRate(cacheHitRate);
        }

        // Check message queue backlog
        if (health.messageQueue?.totalPending !== undefined) {
          this.checkMessageQueueBacklog(health.messageQueue.totalPending);
        }

        this.logger.debug({ alerts: this.activeAlerts.size }, 'Alert monitoring cycle completed');
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to run alert monitoring');
      }
    }, intervalMs);

    this.logger.info({ intervalMs }, 'Alert monitoring started');
  }

  // Helper: Calculate cache hit rate
  calculateCacheHitRate(localCaches) {
    // This is a simplified calculation - in production, use actual hit/miss stats
    // For now, use cache utilization as a proxy
    let totalSize = 0;
    let totalMax = 0;
    
    Object.values(localCaches).forEach(cache => {
      if (cache.size !== undefined && cache.max !== undefined) {
        totalSize += cache.size;
        totalMax += cache.max;
      }
    });
    
    // Calculate utilization percentage
    // Note: This is utilization, not actual hit rate
    // For real hit rate, we'd need to use cacheStats from baileysService
    return totalMax > 0 ? (totalSize / totalMax) * 100 : 100;
  }
}

module.exports = {
  AlertingService,
  ALERT_SEVERITY,
  ALERT_TYPES,
  ALERTING_RULES
};
