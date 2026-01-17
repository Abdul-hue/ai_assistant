/**
 * Test script for performance reporting functionality
 * 
 * Usage: node scripts/test-performance-reporting.js
 */

const path = require('path');
const PerformanceReporter = require('../src/services/performanceReporting');
const logger = require('../src/services/logger');

console.log('\n🔍 Testing Performance Reporting\n' + '='.repeat(60));

async function testPerformanceReporting() {
  try {
    // Create a performance reporter instance directly (don't require baileysService to avoid Supabase deps)
    const performanceReporter = new PerformanceReporter(logger.child({ component: 'performance-test' }));
    
    console.log('✅ Performance reporter created');
    
    // Test 1: Initialize reporter
    console.log('\n📊 Test 1: Initialize Reporter');
    try {
      await performanceReporter.initialize();
      console.log('✅ Reporter initialized successfully');
    } catch (error) {
      console.log('❌ Initialization failed:', error.message);
      return;
    }
    
    // Test 2: Record snapshots
    console.log('\n📊 Test 2: Record Snapshots');
    for (let i = 0; i < 5; i++) {
      const snapshot = {
        connectionTime: Math.random() * 1000 + 500, // 500-1500ms
        messageProcessingTime: Math.random() * 100 + 50, // 50-150ms
        cacheHitRate: Math.random() * 30 + 70, // 70-100%
        errorCount: Math.floor(Math.random() * 5),
        activeConnections: Math.floor(Math.random() * 10) + 1
      };
      
      performanceReporter.recordSnapshot(snapshot);
      console.log(`  ✓ Snapshot ${i + 1} recorded`);
    }
    
    // Test 3: Generate daily report
    console.log('\n📊 Test 3: Generate Daily Report');
    try {
      const dailyReport = await performanceReporter.generateDailyReport();
      
      if (dailyReport) {
        console.log('✅ Daily report generated');
        console.log('  Report type:', dailyReport.type);
        console.log('  Snapshots:', dailyReport.snapshots);
        console.log('  Summary keys:', Object.keys(dailyReport.summary || {}));
        console.log('  Has degradation:', Object.keys(dailyReport.degradation || {}).length > 0);
      } else {
        console.log('⚠️  Daily report returned null (may need more data)');
      }
    } catch (error) {
      console.log('❌ Daily report generation failed:', error.message);
    }
    
    // Test 4: Get latest report
    console.log('\n📊 Test 4: Get Latest Report');
    try {
      const latestReport = await performanceReporter.getLatestReport('daily');
      
      if (latestReport) {
        console.log('✅ Latest daily report retrieved');
        console.log('  Generated at:', latestReport.generatedAt);
        console.log('  Snapshots:', latestReport.snapshots);
      } else {
        console.log('⚠️  No daily reports found yet');
      }
    } catch (error) {
      console.log('❌ Get latest report failed:', error.message);
    }
    
    // Test 5: Check reports directory
    console.log('\n📊 Test 5: Check Reports Directory');
    const fs = require('fs').promises;
    const reportsDir = path.join(__dirname, '../reports');
    
    try {
      const files = await fs.readdir(reportsDir);
      const reportFiles = files.filter(f => f.endsWith('.json'));
      console.log(`✅ Reports directory exists with ${reportFiles.length} report file(s)`);
      
      if (reportFiles.length > 0) {
        console.log('  Report files:');
        reportFiles.forEach(file => {
          console.log(`    - ${file}`);
        });
      }
    } catch (error) {
      console.log('⚠️  Reports directory check failed:', error.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Performance reporting test complete\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testPerformanceReporting().catch(console.error);
