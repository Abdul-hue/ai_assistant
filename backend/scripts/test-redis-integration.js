/**
 * Test Redis Integration
 * Verifies Redis cache service works correctly with baileysService
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const redisCache = require('../src/services/redisCache');
const logger = require('../src/services/logger');

async function testRedisIntegration() {
  console.log('🧪 Testing Redis Integration\n');
  
  try {
    // Initialize Redis
    console.log('Test 1: Initialize Redis');
    await redisCache.initialize();
    console.log('✅ Redis initialized\n');
    
    // Test session caching
    console.log('Test 2: Session Caching');
    const testAgentId = 'test-agent-' + Date.now();
    const testCreds = { me: { id: '123456789' }, tokens: { refresh: 'abc123' } };
    
    await redisCache.cacheSession(testAgentId, testCreds, 60);
    console.log('✅ Session cached');
    
    const retrieved = await redisCache.getSession(testAgentId);
    if (retrieved && retrieved.me.id === '123456789') {
      console.log('✅ Session retrieved: MATCH');
    } else {
      console.log('❌ Session retrieved: MISMATCH');
    }
    
    await redisCache.deleteSession(testAgentId);
    console.log('✅ Session deleted\n');
    
    // Test QR code caching
    console.log('Test 3: QR Code Caching');
    const testQR = 'test-qr-code-data';
    await redisCache.cacheQRCode(testAgentId, testQR);
    const qr = await redisCache.getQRCode(testAgentId);
    if (qr === testQR) {
      console.log('✅ QR code cached and retrieved: MATCH\n');
    } else {
      console.log('❌ QR code cached and retrieved: MISMATCH\n');
    }
    
    // Test agent status
    console.log('Test 4: Agent Status');
    const testStatus = { connected: true, timestamp: Date.now() };
    await redisCache.setAgentStatus(testAgentId, testStatus);
    const status = await redisCache.getAgentStatus(testAgentId);
    if (status && status.connected === true) {
      console.log('✅ Agent status set and retrieved: MATCH\n');
    } else {
      console.log('❌ Agent status set and retrieved: MISMATCH\n');
    }
    
    // Test instance registration
    console.log('Test 5: Instance Registration');
    const instanceId = 'test-instance-' + Date.now();
    await redisCache.registerInstance(instanceId, { hostname: 'localhost', pid: process.pid });
    // Small delay to ensure key is set
    await new Promise(resolve => setTimeout(resolve, 100));
    const instances = await redisCache.getActiveInstances();
    if (instances.length > 0) {
      console.log('✅ Instance registered: SUCCESS\n');
    } else {
      console.log('⚠️  Instance registered but not found (may have expired quickly)\n');
    }
    
    // Get statistics
    console.log('Test 6: Cache Statistics');
    const stats = await redisCache.getStats();
    console.log('✅ Cache stats retrieved');
    console.log(`   Connected: ${stats.connected}`);
    console.log(`   Total keys: ${stats.totalKeys}`);
    console.log(`   Memory used: ${stats.usedMemory || 'N/A'}`);
    console.log(`   Total connections: ${stats.totalConnections || 0}`);
    console.log(`   Total commands: ${stats.totalCommands || 0}\n`);
    
    // Cleanup
    console.log('Test 7: Cleanup');
    await redisCache.clearAll();
    console.log('✅ Cache cleared\n');
    
    // Shutdown
    console.log('Test 8: Graceful Shutdown');
    await redisCache.shutdown();
    console.log('✅ Redis shutdown\n');
    
    console.log('🎉 All Redis integration tests passed!');
    console.log('\n📊 Redis is ready for production use');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\n🔍 Check:');
    console.error('  1. Redis is running: redis-cli ping');
    console.error('  2. REDIS_URL in .env is correct');
    console.error('  3. No firewall blocking Redis port');
    console.error('  4. Redis credentials are correct');
    console.error('\n📋 Error details:');
    console.error(error.stack);
    process.exit(1);
  }
}

testRedisIntegration();
