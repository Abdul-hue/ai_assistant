# Prometheus Metrics Guide

## Overview

The PA Agent system exposes Prometheus-compatible metrics for monitoring and observability. All metrics are prefixed with `pa_agent_` and include default labels for instance identification.

## Available Metrics

### Connection Metrics
- `pa_agent_connections_total` - Total connection attempts (labels: `agent_id`, `user_id`, `result`)
- `pa_agent_connections_active` - Currently active connections (gauge)
- `pa_agent_connection_duration_seconds` - Connection establishment duration (histogram, labels: `agent_id`)
- `pa_agent_connection_failures_total` - Failed connection attempts (labels: `agent_id`, `reason`, `retryable`)

### Message Metrics
- `pa_agent_messages_received_total` - Total messages received (labels: `agent_id`, `message_type`)
- `pa_agent_messages_sent_total` - Total messages sent (labels: `agent_id`, `message_type`)
- `pa_agent_message_processing_duration_seconds` - Message processing duration (histogram, labels: `agent_id`, `operation`)
- `pa_agent_message_batch_size` - Message batch sizes (histogram)

### Cache Metrics
- `pa_agent_cache_hits_total` - Cache hits (labels: `cache_type`)
- `pa_agent_cache_misses_total` - Cache misses (labels: `cache_type`)
- `pa_agent_cache_size` - Current cache size (gauge, labels: `cache_type`)
- `pa_agent_cache_evictions_total` - Cache evictions (labels: `cache_type`)

**Cache Types:**
- `validation` - Phone number validation cache
- `lidToPhone` - LID to phone number mapping cache
- `session` - Session credentials cache

### Database Metrics
- `pa_agent_db_query_duration_seconds` - Database query duration (histogram, labels: `operation`, `table`)
- `pa_agent_db_queries_total` - Total database queries (labels: `operation`, `table`, `result`)

### Error Metrics
- `pa_agent_errors_total` - Total errors (labels: `type`, `severity`, `component`)

### Default Node.js Metrics
The following default metrics are automatically collected:
- `pa_agent_process_cpu_user_seconds_total` - CPU user time
- `pa_agent_process_cpu_system_seconds_total` - CPU system time
- `pa_agent_process_resident_memory_bytes` - Resident memory usage
- `pa_agent_process_heap_bytes` - Heap memory usage
- `pa_agent_nodejs_eventloop_lag_seconds` - Event loop lag
- `pa_agent_nodejs_active_handles_total` - Active handles
- `pa_agent_nodejs_active_requests_total` - Active requests
- `pa_agent_nodejs_version_info` - Node.js version information

## Accessing Metrics

### Local Development
```bash
# Fetch all metrics
curl http://localhost:3001/api/metrics

# Check metrics health
curl http://localhost:3001/api/metrics/health
```

### Production
Replace `localhost:3001` with your production server URL.

## Prometheus Configuration

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'pa-agent'
    scrape_interval: 15s
    scrape_timeout: 10s
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/metrics'
    honor_labels: true
```

### Multiple Instances

For multi-instance deployments, configure multiple targets:

```yaml
scrape_configs:
  - job_name: 'pa-agent'
    scrape_interval: 15s
    static_configs:
      - targets:
        - 'instance1.example.com:3001'
        - 'instance2.example.com:3001'
        - 'instance3.example.com:3001'
    metrics_path: '/api/metrics'
```

## Grafana Queries

### Connection Rate
```promql
# Connection attempts per second
rate(pa_agent_connections_total[5m])

# Success rate
sum(rate(pa_agent_connections_total{result="success"}[5m])) / 
sum(rate(pa_agent_connections_total[5m]))
```

### Active Connections
```promql
# Current active connections
pa_agent_connections_active

# Active connections over time
avg_over_time(pa_agent_connections_active[5m])
```

### Connection Duration
```promql
# Average connection duration
histogram_quantile(0.95, 
  rate(pa_agent_connection_duration_seconds_bucket[5m])
)

# P50 connection duration
histogram_quantile(0.50, 
  rate(pa_agent_connection_duration_seconds_bucket[5m])
)
```

### Message Throughput
```promql
# Messages received per second
sum(rate(pa_agent_messages_received_total[5m])) by (message_type)

# Messages sent per second
sum(rate(pa_agent_messages_sent_total[5m])) by (message_type)
```

### Cache Hit Rate
```promql
# Overall cache hit rate
sum(rate(pa_agent_cache_hits_total[5m])) / 
(sum(rate(pa_agent_cache_hits_total[5m])) + sum(rate(pa_agent_cache_misses_total[5m])))

# Hit rate by cache type
sum(rate(pa_agent_cache_hits_total[5m])) by (cache_type) / 
(sum(rate(pa_agent_cache_hits_total[5m])) by (cache_type) + 
 sum(rate(pa_agent_cache_misses_total[5m])) by (cache_type))
```

### Cache Size
```promql
# Current cache sizes
pa_agent_cache_size

# Cache utilization (if max size is known)
pa_agent_cache_size / 1000  # Assuming max 1000 for validation cache
```

### Database Performance
```promql
# Average query duration
histogram_quantile(0.95, 
  rate(pa_agent_db_query_duration_seconds_bucket[5m])
)

# Query success rate
sum(rate(pa_agent_db_queries_total{result="success"}[5m])) / 
sum(rate(pa_agent_db_queries_total[5m]))
```

### Error Rate
```promql
# Errors per second
sum(rate(pa_agent_errors_total[5m])) by (type, severity, component)

# Error rate by component
sum(rate(pa_agent_errors_total[5m])) by (component)
```

### Memory Usage
```promql
# Heap memory usage
pa_agent_process_heap_bytes / 1024 / 1024  # Convert to MB

# Resident memory usage
pa_agent_process_resident_memory_bytes / 1024 / 1024  # Convert to MB
```

### Event Loop Lag
```promql
# Average event loop lag
avg(pa_agent_nodejs_eventloop_lag_seconds)
```

## Grafana Dashboard Panels

### Recommended Panels

1. **Connection Status**
   - Active connections (gauge)
   - Connection rate (graph)
   - Connection success rate (stat)

2. **Message Throughput**
   - Messages received/sent per second (graph)
   - Message types breakdown (pie chart)

3. **Cache Performance**
   - Cache hit rate (stat)
   - Cache size (graph)
   - Cache evictions (graph)

4. **Database Performance**
   - Query duration P95 (stat)
   - Query success rate (stat)
   - Queries per second (graph)

5. **System Resources**
   - Memory usage (graph)
   - CPU usage (graph)
   - Event loop lag (graph)

6. **Error Tracking**
   - Error rate (graph)
   - Errors by component (table)

## Testing

### Run Test Script
```bash
npm run test:metrics
```

### Manual Testing
```bash
# Start server
npm start

# In another terminal, test metrics
curl http://localhost:3001/api/metrics/health
curl http://localhost:3001/api/metrics | head -20
```

## Configuration

Metrics are enabled by default. To disable:

```env
PROMETHEUS_METRICS_ENABLED=false
```

## Troubleshooting

### Metrics Not Available (503)
- Check if `PROMETHEUS_METRICS_ENABLED` is set to `false`
- Verify `prom-client` package is installed
- Check server logs for initialization errors

### Missing Metrics
- Ensure the service has been running long enough to generate metrics
- Check that operations are being performed (connections, messages, etc.)
- Verify metrics are being recorded in code

### High Cardinality
- Be careful with high-cardinality labels (e.g., `agent_id`)
- Consider aggregating metrics at query time
- Use recording rules for expensive queries

## Best Practices

1. **Scrape Interval**: Use 15-30 second intervals for production
2. **Retention**: Keep metrics for at least 30 days for trend analysis
3. **Alerts**: Set up alerts for:
   - High error rates
   - Low cache hit rates (< 50%)
   - High connection failure rates
   - Memory/CPU thresholds
4. **Recording Rules**: Create recording rules for frequently used queries
5. **Label Cardinality**: Monitor label cardinality to avoid performance issues

## Example Alerts

```yaml
groups:
  - name: pa_agent_alerts
    rules:
      - alert: HighErrorRate
        expr: rate(pa_agent_errors_total[5m]) > 10
        for: 5m
        annotations:
          summary: "High error rate detected"
      
      - alert: LowCacheHitRate
        expr: |
          sum(rate(pa_agent_cache_hits_total[5m])) / 
          (sum(rate(pa_agent_cache_hits_total[5m])) + 
           sum(rate(pa_agent_cache_misses_total[5m]))) < 0.5
        for: 10m
        annotations:
          summary: "Cache hit rate below 50%"
      
      - alert: HighConnectionFailureRate
        expr: |
          sum(rate(pa_agent_connection_failures_total[5m])) / 
          sum(rate(pa_agent_connections_total[5m])) > 0.1
        for: 5m
        annotations:
          summary: "Connection failure rate above 10%"
```
