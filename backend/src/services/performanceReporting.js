const fs = require('fs').promises;
const path = require('path');

class PerformanceReporter {
  constructor(logger) {
    this.logger = logger;
    this.dailyData = [];
    this.weeklyData = [];
    this.reportsDir = path.join(__dirname, '../../reports');
  }

  async initialize() {
    try {
      await fs.mkdir(this.reportsDir, { recursive: true });
      this.logger.info({ reportsDir: this.reportsDir }, 'Performance reports directory initialized');
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to create reports directory');
    }
  }

  // Record snapshot
  recordSnapshot(data) {
    const snapshot = {
      timestamp: new Date().toISOString(),
      ...data
    };
    
    this.dailyData.push(snapshot);
    
    // Keep only last 24 hours of data (288 snapshots at 5-minute intervals)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.dailyData = this.dailyData.filter(s => 
      new Date(s.timestamp).getTime() > oneDayAgo
    );
  }

  // Calculate statistics
  calculateStats(data, field) {
    if (!data.length) return null;
    
    const values = data.map(d => d[field]).filter(v => typeof v === 'number');
    if (!values.length) return null;
    
    const sorted = values.sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)]
    };
  }

  // Detect performance degradation
  detectDegradation(currentAvg, historicalAvg, threshold = 2) {
    if (!historicalAvg || historicalAvg === 0) return false;
    const ratio = currentAvg / historicalAvg;
    return ratio > threshold;
  }

  // Generate daily report
  async generateDailyReport() {
    try {
      const report = {
        type: 'daily',
        generatedAt: new Date().toISOString(),
        period: {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString()
        },
        snapshots: this.dailyData.length,
        summary: {}
      };

      // Calculate statistics for each metric
      const metrics = ['connectionTime', 'messageProcessingTime', 'cacheHitRate', 'errorCount', 'activeConnections'];
      
      metrics.forEach(metric => {
        const stats = this.calculateStats(this.dailyData, metric);
        if (stats) {
          report.summary[metric] = stats;
        }
      });

      // Detect degradation
      report.degradation = {};
      if (this.dailyData.length >= 24) { // Need at least 2 hours of data
        const recent = this.dailyData.slice(-12); // Last hour (12 x 5min)
        const older = this.dailyData.slice(0, 12); // First hour
        
        const recentAvgConnection = this.calculateStats(recent, 'connectionTime')?.avg;
        const olderAvgConnection = this.calculateStats(older, 'connectionTime')?.avg;
        
        if (recentAvgConnection && olderAvgConnection && 
            this.detectDegradation(recentAvgConnection, olderAvgConnection)) {
          report.degradation.connectionTime = {
            current: recentAvgConnection,
            baseline: olderAvgConnection,
            ratio: (recentAvgConnection / olderAvgConnection).toFixed(2),
            severity: 'warning'
          };
        }
      }

      // Write report to file
      const filename = `daily_${new Date().toISOString().split('T')[0]}.json`;
      const filepath = path.join(this.reportsDir, filename);
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));

      // Log report
      this.logger.info({
        report: {
          type: report.type,
          snapshots: report.snapshots,
          filepath,
          hasDegradation: Object.keys(report.degradation).length > 0
        }
      }, 'Daily performance report generated');

      // Archive to weekly data
      this.weeklyData.push(report);

      // Keep only last 7 daily reports
      if (this.weeklyData.length > 7) {
        this.weeklyData.shift();
      }

      return report;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to generate daily report');
      return null;
    }
  }

  // Generate weekly report
  async generateWeeklyReport() {
    try {
      if (this.weeklyData.length === 0) {
        this.logger.warn('No daily reports available for weekly summary');
        return null;
      }

      const report = {
        type: 'weekly',
        generatedAt: new Date().toISOString(),
        period: {
          start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString()
        },
        dailyReports: this.weeklyData.length,
        summary: {},
        trends: {}
      };

      // Aggregate statistics from daily reports
      const metrics = ['connectionTime', 'messageProcessingTime', 'cacheHitRate', 'errorCount'];
      
      metrics.forEach(metric => {
        const allValues = this.weeklyData
          .filter(d => d.summary?.[metric])
          .map(d => d.summary[metric].avg);
        
        if (allValues.length) {
          report.summary[metric] = {
            weeklyAvg: allValues.reduce((a, b) => a + b, 0) / allValues.length,
            min: Math.min(...allValues),
            max: Math.max(...allValues),
            trend: this.calculateTrend(allValues)
          };
        }
      });

      // Calculate trends
      report.trends = this.calculateTrends();

      // Write report to file
      const weekNumber = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
      const filename = `weekly_${new Date().getFullYear()}_W${weekNumber}.json`;
      const filepath = path.join(this.reportsDir, filename);
      await fs.writeFile(filepath, JSON.stringify(report, null, 2));

      // Log report
      this.logger.info({
        report: {
          type: report.type,
          dailyReports: report.dailyReports,
          filepath
        }
      }, 'Weekly performance report generated');

      return report;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to generate weekly report');
      return null;
    }
  }

  // Calculate trend direction
  calculateTrend(values) {
    if (values.length < 2) return 'stable';
    
    const first = values[0];
    const last = values[values.length - 1];
    const change = ((last - first) / first) * 100;
    
    if (Math.abs(change) < 5) return 'stable';
    return change > 0 ? 'increasing' : 'decreasing';
  }

  // Calculate trends from weekly data
  calculateTrends() {
    if (this.weeklyData.length < 2) return {};

    const trends = {};
    const first = this.weeklyData[0];
    const last = this.weeklyData[this.weeklyData.length - 1];

    ['connectionTime', 'messageProcessingTime', 'cacheHitRate', 'errorCount'].forEach(metric => {
      if (first.summary?.[metric] && last.summary?.[metric]) {
        const change = ((last.summary[metric].avg - first.summary[metric].avg) / first.summary[metric].avg) * 100;
        trends[metric] = {
          direction: change > 0 ? 'increasing' : 'decreasing',
          change: `${Math.abs(change).toFixed(2)}%`,
          status: Math.abs(change) > 20 ? 'significant' : 'normal'
        };
      }
    });

    return trends;
  }

  // Get latest report
  async getLatestReport(type = 'daily') {
    try {
      const files = await fs.readdir(this.reportsDir);
      const reportFiles = files.filter(f => f.startsWith(type));
      
      if (reportFiles.length === 0) return null;
      
      // Get most recent file
      reportFiles.sort().reverse();
      const latestFile = reportFiles[0];
      const content = await fs.readFile(path.join(this.reportsDir, latestFile), 'utf8');
      
      return JSON.parse(content);
    } catch (error) {
      this.logger.error({ error: error.message, type }, 'Failed to get latest report');
      return null;
    }
  }
}

module.exports = PerformanceReporter;
