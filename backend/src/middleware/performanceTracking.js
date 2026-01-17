const promClient = require('prom-client');
const { performance } = require('perf_hooks');

// Performance metrics
// Note: These will be registered with metricsRegistry in baileysService.js
// We create them without registers here, then register them explicitly
let httpRequestDuration = null;
let slowOperationCounter = null;
let resourceUsageGauge = null;

// Initialize metrics (called from baileysService after registry is created)
function initializeMetrics(metricsRegistry) {
  if (!metricsRegistry) {
    // Fallback: use default registry if no custom registry provided
    httpRequestDuration = new promClient.Histogram({
      name: 'pa_agent_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
    });

    slowOperationCounter = new promClient.Counter({
      name: 'pa_agent_slow_operations_total',
      help: 'Total slow operations detected',
      labelNames: ['operation', 'threshold']
    });

    resourceUsageGauge = new promClient.Gauge({
      name: 'pa_agent_resource_usage',
      help: 'Resource usage percentage',
      labelNames: ['resource_type']
    });
  } else {
    // Create with custom registry
    httpRequestDuration = new promClient.Histogram({
      name: 'pa_agent_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [metricsRegistry]
    });

    slowOperationCounter = new promClient.Counter({
      name: 'pa_agent_slow_operations_total',
      help: 'Total slow operations detected',
      labelNames: ['operation', 'threshold'],
      registers: [metricsRegistry]
    });

    resourceUsageGauge = new promClient.Gauge({
      name: 'pa_agent_resource_usage',
      help: 'Resource usage percentage',
      labelNames: ['resource_type'],
      registers: [metricsRegistry]
    });
  }
}

// Initialize with default registry as fallback
initializeMetrics(null);

// Performance tracking middleware
function performanceTrackingMiddleware(logger) {
  return (req, res, next) => {
    const startTime = performance.now();

    // Track response
    res.on('finish', () => {
      const duration = (performance.now() - startTime) / 1000; // Convert to seconds
      const route = req.route?.path || req.path;

      // Record HTTP request duration
      httpRequestDuration.labels(req.method, route, res.statusCode).observe(duration);

      // Detect slow operations (>5 seconds)
      if (duration > 5 && slowOperationCounter) {
        slowOperationCounter.labels(route, '5s').inc();
        logger.warn({
          method: req.method,
          route,
          duration: `${duration.toFixed(2)}s`,
          statusCode: res.statusCode
        }, 'Slow HTTP request detected');
      }

      // Log request performance
      logger.debug({
        method: req.method,
        route,
        statusCode: res.statusCode,
        duration: `${duration.toFixed(3)}s`
      }, 'HTTP request completed');
    });

    next();
  };
}

// Resource monitoring function
function startResourceMonitoring(logger, intervalMs = 30000) {
  setInterval(() => {
    try {
      const usage = process.memoryUsage();

      // Memory usage percentage (assuming 2GB limit)
      const memoryLimit = 2 * 1024 * 1024 * 1024; // 2GB in bytes
      const memoryPercent = (usage.heapUsed / memoryLimit) * 100;

      // Update gauges (only if metric is initialized)
      if (resourceUsageGauge) {
        resourceUsageGauge.labels('memory_heap').set(memoryPercent);
        resourceUsageGauge.labels('memory_rss').set((usage.rss / memoryLimit) * 100);
      }

      // Log if memory usage is high (>80%)
      if (memoryPercent > 80) {
        logger.warn({
          heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
          rss: `${(usage.rss / 1024 / 1024).toFixed(2)}MB`,
          percent: `${memoryPercent.toFixed(2)}%`
        }, 'High memory usage detected');
      }

      // Log resource usage periodically
      logger.debug({
        memory: {
          heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
          rss: `${(usage.rss / 1024 / 1024).toFixed(2)}MB`
        }
      }, 'Resource usage');

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to monitor resources');
    }
  }, intervalMs);
  
  logger.info({ intervalMs }, 'Resource monitoring started');
}

// Operation performance tracker
class OperationTracker {
  constructor(operationName, logger, thresholdMs = 1000) {
    this.operationName = operationName;
    this.logger = logger;
    this.thresholdMs = thresholdMs;
    this.startTime = performance.now();
  }

  end(metadata = {}) {
    const duration = performance.now() - this.startTime;

    // Record slow operation (only if metric is initialized)
    if (duration > this.thresholdMs && slowOperationCounter) {
      slowOperationCounter.labels(this.operationName, `${this.thresholdMs}ms`).inc();
      this.logger.warn({
        operation: this.operationName,
        duration: `${duration.toFixed(2)}ms`,
        threshold: `${this.thresholdMs}ms`,
        ...metadata
      }, 'Slow operation detected');
    }

    // Log operation completion
    this.logger.debug({
      operation: this.operationName,
      duration: `${duration.toFixed(2)}ms`,
      ...metadata
    }, 'Operation completed');

    return duration;
  }
}

module.exports = {
  performanceTrackingMiddleware,
  startResourceMonitoring,
  OperationTracker,
  initializeMetrics,
  httpRequestDuration,
  slowOperationCounter,
  resourceUsageGauge
};
