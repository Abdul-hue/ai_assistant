/**
 * Test Prometheus Metrics Endpoint
 * Verifies metrics are exposed correctly
 */

const http = require('http');

console.log('\n🔍 Testing Prometheus Metrics\n' + '='.repeat(60));

async function fetch(url) {
  return new Promise((resolve, reject) => {
    // Use IPv4 explicitly to avoid IPv6 connection issues
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname === 'localhost' ? '127.0.0.1' : urlObj.hostname,
      port: urlObj.port || 3001,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      family: 4 // Force IPv4
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: async () => data,
          json: async () => JSON.parse(data)
        });
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function testMetrics() {
  // Use 127.0.0.1 instead of localhost to force IPv4 (avoids IPv6 ::1 issues)
  const baseURL = 'http://127.0.0.1:3001';
  
  // Test 1: Metrics health
  console.log('\n📊 Test 1: Metrics Health Check');
  try {
    const response = await fetch(`${baseURL}/api/metrics/health`);
    const data = await response.json();
    console.log('✅ Metrics health:', JSON.stringify(data, null, 2));
    
    if (!data.enabled) {
      console.log('⚠️  Warning: Metrics are disabled');
    }
  } catch (error) {
    console.log('❌ Metrics health failed:', error.message);
  }

  // Test 2: Fetch metrics
  console.log('\n📊 Test 2: Fetch Prometheus Metrics');
  try {
    const response = await fetch(`${baseURL}/api/metrics`);
    const metrics = await response.text();
    
    if (response.status !== 200) {
      console.log(`❌ Metrics endpoint returned status ${response.status}`);
      console.log('Response:', metrics);
      return;
    }
    
    // Parse metrics
    const lines = metrics.split('\n').filter(line => 
      line && !line.startsWith('#')
    );
    
    console.log(`✅ Retrieved ${lines.length} metric lines`);
    
    // Show sample metrics
    console.log('\n📈 Sample Metrics:');
    const sampleMetrics = lines.slice(0, 10);
    sampleMetrics.forEach(line => {
      if (line.trim()) {
        console.log(`   ${line.substring(0, 80)}${line.length > 80 ? '...' : ''}`);
      }
    });
    
    // Check for expected metrics
    console.log('\n🔎 Checking for expected metrics:');
    const expectedPrefixes = [
      'pa_agent_connections_',
      'pa_agent_messages_',
      'pa_agent_cache_',
      'pa_agent_db_',
      'pa_agent_errors_',
      'pa_agent_process_cpu_',
      'pa_agent_nodejs_heap_'
    ];
    
    const foundMetrics = {};
    expectedPrefixes.forEach(prefix => {
      const found = lines.some(line => line.startsWith(prefix));
      foundMetrics[prefix] = found;
      console.log(`   ${found ? '✅' : '❌'} ${prefix}*`);
    });
    
    // Count metrics by type
    const metricCounts = {
      connection: lines.filter(l => l.startsWith('pa_agent_connections_')).length,
      message: lines.filter(l => l.startsWith('pa_agent_messages_')).length,
      cache: lines.filter(l => l.startsWith('pa_agent_cache_')).length,
      database: lines.filter(l => l.startsWith('pa_agent_db_')).length,
      error: lines.filter(l => l.startsWith('pa_agent_errors_')).length,
      process: lines.filter(l => l.startsWith('pa_agent_process_')).length,
      nodejs: lines.filter(l => l.startsWith('pa_agent_nodejs_')).length
    };
    
    console.log('\n📊 Metric Counts:');
    Object.entries(metricCounts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count} metrics`);
    });
    
    // Verify content type
    const contentType = response.headers['content-type'];
    if (contentType && contentType.includes('text/plain')) {
      console.log('\n✅ Content-Type is correct:', contentType);
    } else {
      console.log('\n⚠️  Content-Type:', contentType || 'not set');
    }
    
  } catch (error) {
    console.log('❌ Fetch metrics failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('   Make sure the server is running: npm start');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Metrics test complete\n');
}

// Run tests
testMetrics().catch(console.error);
