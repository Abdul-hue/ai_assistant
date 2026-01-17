# Real-Time Monitoring Dashboard

## Access

Open in browser: **http://localhost:3001/dashboard**

## Features

### Live Statistics
- **Active Connections**: Currently connected WhatsApp agents
- **Messages/min**: Real-time message throughput
- **Cache Hit Rate**: Overall cache effectiveness
- **Memory Usage**: Current heap memory usage
- **Error Rate**: Errors per minute
- **Active Alerts**: Current system alerts

### Time-Series Charts
- **Connection Trend**: 1-hour history of active connections (updates every 5 seconds)
- **Message Throughput**: 1-hour history of message rates (updates every 5 seconds)

### Alerts Panel
- Real-time active alerts with severity indicators
- Alert count and last triggered time
- Color-coded: Red (critical), Yellow (warning)

### Errors Panel
- Recent error patterns (last 5 minutes)
- Error category and severity
- Error frequency count
- Last seen timestamp

## Auto-Refresh

Dashboard refreshes **every 5 seconds** automatically.

## Status Indicator

Top of dashboard shows system status:
- **Green**: System Healthy (no alerts)
- **Yellow**: Warnings Active (non-critical alerts)
- **Red**: Critical Alerts (immediate attention needed)

## Data Sources

The dashboard pulls data from:
- `/api/health/detailed` - Main health endpoint

All metrics are real-time and update automatically.

## Browser Requirements

- Modern browser with ES6 support
- JavaScript enabled
- Chart.js loads from CDN (requires internet)

## Customization

Edit `backend/public/dashboard.html` to customize:

### Change Refresh Interval
```javascript
const REFRESH_INTERVAL = 10000; // 10 seconds instead of 5
```

### Change History Length
```javascript
const HISTORY_LENGTH = 120; // 120 data points instead of 60
```

### Add New Stat Card
```html
<div class="card">
  <div class="card-header">Custom Metric</div>
  <div class="card-value" id="customMetric">--</div>
  <div class="card-label">Description</div>
</div>
```

Then update in JavaScript:
```javascript
document.getElementById('customMetric').textContent = data.customMetric || '--';
```

### Modify Colors
Edit the CSS variables in the `<style>` section:
```css
.status-healthy { background: #10b981; } /* Green */
.status-warning { background: #f59e0b; } /* Yellow */
.status-error { background: #ef4444; }   /* Red */
```

## Production Deployment

### 1. Add Authentication

Protect the dashboard in production:
```javascript
// In app.js
const authMiddleware = require('./src/middleware/auth');

app.get('/dashboard', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
```

### 2. Use HTTPS

Always serve dashboard over HTTPS in production:
```javascript
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('path/to/private-key.pem'),
  cert: fs.readFileSync('path/to/certificate.pem')
};

https.createServer(options, app).listen(443);
```

### 3. Add CORS Headers

If dashboard is on different domain:
```javascript
app.use('/dashboard', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://yourdomain.com');
  next();
});
```

### 4. Rate Limiting

Prevent abuse:
```javascript
const rateLimit = require('express-rate-limit');

const dashboardLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60 // 60 requests per minute
});

app.use('/dashboard', dashboardLimiter);
```

## Embedding in Admin Panel

To embed in your existing admin interface:

### Option 1: iFrame
```html
<iframe 
  src="http://localhost:3001/dashboard" 
  width="100%" 
  height="800px" 
  frameborder="0">
</iframe>
```

### Option 2: Component Integration
Copy the dashboard HTML/CSS/JS into your React/Vue/Angular component.

### Option 3: API Integration
Use the `/api/health/detailed` endpoint directly in your admin panel:
```javascript
async function fetchHealthData() {
  const response = await fetch('/api/health/detailed');
  const data = await response.json();
  // Use data in your component
}
```

## Troubleshooting

### Dashboard Not Loading
1. Check server is running: `npm start`
2. Verify port is correct: http://localhost:3001/dashboard
3. Check browser console for errors (F12)
4. Verify `public/dashboard.html` exists

### Data Not Updating
1. Check `/api/health/detailed` is accessible:
   ```bash
   curl http://localhost:3001/api/health/detailed
   ```
2. Verify no CORS errors in console
3. Check server logs for API errors
4. Verify network tab shows successful requests

### Charts Not Rendering
1. Verify Chart.js CDN is accessible (requires internet)
2. Check browser console for errors
3. Try refreshing the page (Ctrl+F5)
4. Check if ad blocker is blocking CDN

### Memory Issues
If dashboard causes browser memory issues:
1. Reduce HISTORY_LENGTH (e.g., from 60 to 30)
2. Increase REFRESH_INTERVAL (e.g., from 5s to 10s)
3. Close other browser tabs
4. Use browser's task manager to check memory usage

### CORS Errors
If you see CORS errors:
1. Verify dashboard is served from same origin as API
2. Check if API has CORS middleware enabled
3. For cross-origin, add CORS headers (see Production section)

## Comparison: Dashboard vs Grafana

| Feature | Web Dashboard | Grafana |
|---------|--------------|---------|
| Setup | Instant (built-in) | Requires installation |
| Authentication | Built-in | Separate |
| Customization | HTML/CSS/JS | Grafana config |
| Alerting | Basic display | Advanced rules |
| History | 1 hour (in-browser) | Unlimited (Prometheus) |
| Performance | Lightweight | Resource-intensive |
| Best For | Quick monitoring | Deep analysis |
| Real-time | 5-second updates | Configurable |
| Embedding | Easy (iframe/component) | Requires iframe |

**Recommendation**: Use both!
- **Web Dashboard**: Quick checks, embedded monitoring, real-time updates
- **Grafana**: Historical analysis, complex queries, alerting, long-term trends

## API Endpoint Reference

The dashboard uses `/api/health/detailed` which returns:

```json
{
  "status": "healthy",
  "agents": {
    "assigned": 10,
    "max": 100
  },
  "resources": {
    "memory": {
      "heapUsed": "123MB"
    }
  },
  "localCaches": {
    "session": { "size": 50, "max": 500 },
    "validation": { "size": 200, "max": 1000 }
  },
  "messageQueue": {
    "totalPending": 0
  },
  "errorStats": {
    "currentRate": "0.5/min",
    "last5Minutes": {
      "total": 2,
      "topPatterns": [...]
    }
  },
  "alertStats": {
    "active": 0,
    "activeAlerts": []
  }
}
```

## Next Steps

1. ✅ Access dashboard: http://localhost:3001/dashboard
2. ✅ Verify all metrics are updating
3. ✅ Customize refresh interval if needed
4. ✅ Add authentication for production
5. ✅ Consider embedding in admin panel
6. ✅ Set up Grafana for historical analysis
7. ✅ Configure alerts in Grafana for long-term monitoring

## Support

For issues:
1. Check server logs: `npm start`
2. Check browser console (F12)
3. Verify `/api/health/detailed` endpoint
4. Test with curl: `curl http://localhost:3001/api/health/detailed`
5. Check network tab in browser DevTools

## Performance Tips

1. **Reduce refresh rate** if dashboard is on a slow connection
2. **Limit history** if browser memory is constrained
3. **Use Grafana** for long-term historical analysis
4. **Close unused tabs** to free browser memory
5. **Monitor browser memory** using DevTools Performance tab

## Security Considerations

1. **Add authentication** before production deployment
2. **Use HTTPS** to encrypt dashboard traffic
3. **Rate limit** dashboard access to prevent abuse
4. **Sanitize data** displayed in dashboard (XSS prevention)
5. **Restrict access** to internal network only if possible

## Future Enhancements

Potential improvements:
- [ ] Add more chart types (bar, pie, gauge)
- [ ] Add export functionality (CSV, PNG)
- [ ] Add time range selector
- [ ] Add metric filtering
- [ ] Add dark/light theme toggle
- [ ] Add metric comparison (before/after)
- [ ] Add alert configuration UI
- [ ] Add metric drill-down capabilities
