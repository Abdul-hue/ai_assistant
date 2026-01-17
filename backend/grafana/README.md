# PA Agent Grafana Dashboards

## Quick Start

### 1. Install Prometheus

Download from: https://prometheus.io/download/

Or using Docker:
```bash
docker run -d -p 9090:9090 -v ./prometheus.yml:/etc/prometheus/prometheus.yml prom/prometheus
```

### 2. Configure Prometheus

Create `prometheus.yml`:
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'pa-agent'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3001', 'localhost:3002', 'localhost:3003']
    metrics_path: '/api/metrics'
```

### 3. Install Grafana

Download from: https://grafana.com/grafana/download

Or using Docker:
```bash
docker run -d -p 3000:3000 grafana/grafana
```

### 4. Add Prometheus Data Source

1. Open Grafana: http://localhost:3000 (default: admin/admin)
2. Go to Configuration → Data Sources
3. Click "Add data source"
4. Select "Prometheus"
5. URL: http://localhost:9090
6. Click "Save & Test"

### 5. Import Dashboard

1. Go to Dashboards → Import
2. Upload: `grafana/dashboards/pa-agent-overview.json`
3. Select Prometheus data source
4. Click "Import"

## Easy Setup with Docker Compose

The fastest way to get started:

```bash
cd backend/grafana
docker-compose up -d
```

This will start:
- Prometheus on http://localhost:9090
- Grafana on http://localhost:3000 (admin/admin)

Then:
1. Add Prometheus data source in Grafana (see step 4 above)
2. Import the dashboard (see step 5 above)

## Available Metrics

### Connection Metrics
```promql
# Active connections
pa_agent_connections_active{instance="$instance"}

# Connection rate (5m)
rate(pa_agent_connections_total{instance="$instance"}[5m])

# Connection duration P95
histogram_quantile(0.95, rate(pa_agent_connection_duration_seconds_bucket{instance="$instance"}[5m]))

# Connection failures
rate(pa_agent_connection_failures_total{instance="$instance"}[5m])
```

### Message Metrics
```promql
# Message throughput
rate(pa_agent_messages_received_total{instance="$instance"}[5m])
rate(pa_agent_messages_sent_total{instance="$instance"}[5m])

# Message processing time P95
histogram_quantile(0.95, rate(pa_agent_message_processing_duration_seconds_bucket{instance="$instance"}[5m]))

# Message batch sizes
histogram_quantile(0.95, rate(pa_agent_message_batch_size_bucket{instance="$instance"}[5m]))
```

### Cache Metrics
```promql
# Cache hit rate
sum(rate(pa_agent_cache_hits_total{instance="$instance"}[5m])) by (cache_type) /
(sum(rate(pa_agent_cache_hits_total{instance="$instance"}[5m])) by (cache_type) +
 sum(rate(pa_agent_cache_misses_total{instance="$instance"}[5m])) by (cache_type))

# Cache size
pa_agent_cache_size{instance="$instance"}

# Cache evictions
rate(pa_agent_cache_evictions_total{instance="$instance"}[5m])
```

### Database Metrics
```promql
# Query duration P95
histogram_quantile(0.95, rate(pa_agent_db_query_duration_seconds_bucket{instance="$instance"}[5m]))

# Query rate
rate(pa_agent_db_queries_total{instance="$instance"}[5m])

# Query success rate
sum(rate(pa_agent_db_queries_total{instance="$instance", result="success"}[5m])) /
sum(rate(pa_agent_db_queries_total{instance="$instance"}[5m])) * 100
```

### Error Metrics
```promql
# Error rate by category
rate(pa_agent_errors_total{instance="$instance"}[5m])

# Error rate by severity
sum(rate(pa_agent_errors_total{instance="$instance"}[5m])) by (severity)

# Error patterns
pa_agent_error_pattern_count{instance="$instance"}
```

### Performance Metrics
```promql
# HTTP request duration P95
histogram_quantile(0.95, rate(pa_agent_http_request_duration_seconds_bucket{instance="$instance"}[5m]))

# Slow operations
rate(pa_agent_slow_operations_total{instance="$instance"}[5m])

# Resource usage
pa_agent_resource_usage{instance="$instance"}
```

### System Metrics
```promql
# Memory usage
pa_agent_process_resident_memory_bytes{instance="$instance"}

# CPU usage
rate(pa_agent_process_cpu_seconds_total{instance="$instance"}[5m])

# Event loop lag
pa_agent_nodejs_eventloop_lag_seconds{instance="$instance"}

# Heap usage
pa_agent_nodejs_heap_bytes_used{instance="$instance"}
pa_agent_nodejs_heap_bytes_total{instance="$instance"}
```

## Dashboard Panels

The main dashboard includes:

### Row 1: Overview
- **Active Connections** (stat panel) - Current number of active WhatsApp connections
- **Message Rate** (stat panel) - Messages per second over 5 minutes
- **Error Rate** (stat panel) - Errors per second over 5 minutes
- **Cache Hit Rate** (stat panel) - Overall cache hit percentage

### Row 2: Connections
- **Connection Rate Graph** - Success vs failure rates over time
- **Connection Duration P95** - 95th percentile connection establishment time

### Row 3: Messages
- **Message Throughput** - Received vs sent messages over time
- **Message Processing Time** - P95 processing duration

### Row 4: Cache Performance
- **Cache Hit Rate by Type** - Session cache vs validation cache hit rates
- **Cache Size** - Current cache sizes by type
- **Memory Usage** - RSS and heap memory usage

### Row 5: Errors & Database
- **Error Rate by Category** - Errors grouped by category (connection, database, etc.)
- **Database Query Duration** - P95 query times by operation and table

## Alerting

Configure alerts in Grafana:

### Critical Alerts
- **Connection failure rate > 10%** for 5 minutes
- **Memory usage > 90%** for 1 minute
- **Database error rate > 50/min** for 1 minute
- **Event loop lag > 1 second** for 5 minutes

### Warning Alerts
- **Cache hit rate < 50%** for 10 minutes
- **HTTP request P95 > 5 seconds** for 5 minutes
- **Error rate increasing by 50%** over 10 minutes
- **Message queue backlog > 1000** messages

### Example Alert Configuration

In Grafana → Alerting → Alert rules:

**Connection Failure Rate Alert:**
```promql
(
  sum(rate(pa_agent_connections_total{result="failure"}[5m])) /
  sum(rate(pa_agent_connections_total[5m]))
) * 100 > 10
```

**Memory Usage Alert:**
```promql
(pa_agent_process_resident_memory_bytes / 2147483648) * 100 > 90
```

**Database Error Rate Alert:**
```promql
sum(rate(pa_agent_errors_total{category="database"}[1m])) > 50
```

## Notification Channels

Configure in Grafana → Alerting → Notification channels:

### Slack
1. Create Slack webhook: https://api.slack.com/messaging/webhooks
2. In Grafana, add notification channel:
   - Type: Slack
   - Webhook URL: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   - Channel: #alerts

### Email
1. Configure SMTP in Grafana config:
```ini
[smtp]
enabled = true
host = smtp.gmail.com:587
user = your-email@gmail.com
password = your-password
```
2. Add email notification channel:
   - Type: Email
   - Addresses: alerts@yourcompany.com

### PagerDuty
1. Create PagerDuty integration
2. Add notification channel:
   - Type: PagerDuty
   - Integration Key: YOUR_PAGERDUTY_KEY

## Troubleshooting

### No Data in Grafana
1. **Check Prometheus is running**: http://localhost:9090
2. **Check PA Agent metrics**: http://localhost:3001/api/metrics
3. **Check Prometheus targets**: http://localhost:9090/targets
   - Should show "UP" status for pa-agent job
4. **Verify data source in Grafana**:
   - Configuration → Data Sources → Prometheus
   - Click "Save & Test" - should show "Data source is working"

### Metrics Not Updating
1. **Check scrape interval** in prometheus.yml (default: 15s)
2. **Verify PA Agent server is running** on configured ports
3. **Check Prometheus logs** for errors:
   ```bash
   docker logs pa-agent-prometheus
   ```
4. **Refresh Grafana dashboard** (top right refresh button)

### High Memory in Prometheus
1. **Adjust retention time** in prometheus.yml:
```yaml
storage:
  tsdb:
    retention.time: 15d
    retention.size: 10GB
```
2. **Use recording rules** for complex queries (see below)
3. **Reduce scrape interval** if not needed (e.g., 30s instead of 15s)

### Dashboard Not Loading
1. **Check dashboard JSON syntax** - validate at https://jsonlint.com/
2. **Verify data source variable** - should be `${DS_PROMETHEUS}`
3. **Check panel queries** - test in Prometheus query editor first
4. **Clear browser cache** and reload

## Recording Rules (Optional)

For better performance with complex queries, create recording rules in `prometheus-rules.yml`:

```yaml
groups:
  - name: pa_agent_rules
    interval: 30s
    rules:
      - record: pa_agent:connection_success_rate:5m
        expr: |
          sum(rate(pa_agent_connections_total{result="success"}[5m]))
          /
          sum(rate(pa_agent_connections_total[5m]))

      - record: pa_agent:cache_hit_rate:5m
        expr: |
          sum(rate(pa_agent_cache_hits_total[5m]))
          /
          (sum(rate(pa_agent_cache_hits_total[5m])) + sum(rate(pa_agent_cache_misses_total[5m])))

      - record: pa_agent:error_rate:5m
        expr: |
          sum(rate(pa_agent_errors_total[5m])) by (category)

      - record: pa_agent:message_throughput:5m
        expr: |
          sum(rate(pa_agent_messages_received_total[5m]))
```

Add to prometheus.yml:
```yaml
rule_files:
  - "prometheus-rules.yml"
```

Then use in Grafana:
```promql
# Instead of complex query, use:
pa_agent:cache_hit_rate:5m
```

## Custom Dashboards

### Create Agent-Specific Dashboard

1. Duplicate the main dashboard
2. Add filter by agent_id:
   ```promql
   pa_agent_connections_active{agent_id="your-agent-id"}
   ```
3. Add agent-specific panels:
   - Connection status
   - Message count
   - Error count
   - Cache performance

### Create Performance Dashboard

Focus on performance metrics:
- Connection establishment time
- Message processing time
- Database query duration
- Cache hit rates
- HTTP request latency

### Create Error Dashboard

Focus on error tracking:
- Error rate by category
- Error rate by severity
- Error patterns
- Top error messages
- Error trends over time

## Best Practices

1. **Use appropriate time ranges**:
   - Real-time monitoring: 5m-1h
   - Daily review: 24h
   - Weekly review: 7d

2. **Set up alerts early**:
   - Start with critical alerts
   - Add warning alerts as needed
   - Test alert notifications

3. **Monitor key metrics**:
   - Connection success rate
   - Message throughput
   - Error rate
   - Cache hit rate
   - Memory usage

4. **Regular dashboard review**:
   - Daily: Check for anomalies
   - Weekly: Review trends
   - Monthly: Analyze patterns

5. **Document custom queries**:
   - Add descriptions to panels
   - Document in team wiki
   - Share with team members

## Next Steps

1. ✅ Set up Prometheus and Grafana
2. ✅ Import the dashboard
3. ✅ Configure alerting
4. ✅ Set up notification channels
5. ✅ Create custom dashboards for specific needs
6. ✅ Set up recording rules for performance
7. ✅ Document team-specific queries
8. ✅ Schedule regular dashboard reviews

## Additional Resources

- **Prometheus Documentation**: https://prometheus.io/docs/
- **Grafana Documentation**: https://grafana.com/docs/
- **PromQL Guide**: https://prometheus.io/docs/prometheus/latest/querying/basics/
- **Grafana Dashboard Examples**: https://grafana.com/grafana/dashboards/

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review Prometheus and Grafana logs
3. Test queries in Prometheus query editor
4. Verify metrics endpoint: http://localhost:3001/api/metrics

## File Structure

```
backend/grafana/
├── dashboards/
│   └── pa-agent-overview.json    # Main dashboard
├── panels/                        # Reusable panel templates (future)
├── prometheus.yml                 # Prometheus configuration
├── docker-compose.yml             # Docker Compose setup
└── README.md                      # This file
```
