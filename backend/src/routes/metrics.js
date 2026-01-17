/**
 * Prometheus Metrics Endpoint
 * Exposes metrics for Prometheus scraping
 * Phase 3: Metrics Collection
 */

const express = require('express');
const router = express.Router();

// GET /api/metrics - Prometheus metrics endpoint
router.get('/', async (req, res) => {
  try {
    const { metricsRegistry } = require('../services/baileysService');
    
    if (!metricsRegistry) {
      return res.status(503).json({
        error: 'Metrics not available',
        message: 'Prometheus metrics are disabled or not initialized'
      });
    }

    // Set Prometheus content type
    res.set('Content-Type', metricsRegistry.contentType);
    
    // Get metrics
    const metrics = await metricsRegistry.metrics();
    
    res.end(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      message: error.message
    });
  }
});

// GET /api/metrics/health - Metrics health check
router.get('/health', (req, res) => {
  try {
    // Access METRICS_CONFIG from baileysService
    // Note: METRICS_CONFIG is not exported, so we'll check metricsRegistry instead
    const { metricsRegistry } = require('../services/baileysService');
    const os = require('os');
    
    res.json({
      enabled: metricsRegistry !== null,
      prefix: 'pa_agent_',
      instance: os.hostname(),
      endpoint: '/api/metrics',
      registry: metricsRegistry ? 'initialized' : 'not_initialized'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check metrics health',
      message: error.message
    });
  }
});

module.exports = router;
