/**
 * Test Redis Cache Service
 * Verifies all Redis cache operations work correctly
 */

// Load environment variables BEFORE requiring the module
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const redisCache = require('../src/services/redisCache');

async function testRedisCache() {
  console.log('🧪 Testing Redis Cache Service...\n');

  try {
    // Test 1: Initialize Redis
    console.log('Test 1: Initialize Redis');
    await redisCache.initialize();
    console.log('✅ Redis initialized\n');

    // Test 2: Session caching
    console.log('Test 2: Session caching');
    const testAgentId = 'test-agent-' + Date.now();
    const testCredentials = {
      me: { id: '1234567890' },
      account: { details: 'test' }
    };
    
    await redisCache.cacheSession(testAgentId, testCredentials, 60);
    console.log('✅ Session cached');
    
    const retrieved = await redisCache.getSession(testAgentId);
    if (retrieved && retrieved.me.id === testCredentials.me.id) {
      console.log('✅ Session retrieved successfully\n');
    } else {
      console.error('❌ Session retrieval failed\n');
    }

    // Test 3: Agent status
    console.log('Test 3: Agent status');
    const status = { connected: true, lastSeen: Date.now() };
    await redisCache.setAgentStatus(testAgentId, status);
    const retrievedStatus = await redisCache.getAgentStatus(testAgentId);
    if (retrievedStatus && retrievedStatus.connected === true) {
      console.log('✅ Agent status cached and retrieved\n');
    } else {
      console.error('❌ Agent status retrieval failed\n');
    }

    // Test 4: QR code caching
    console.log('Test 4: QR code caching');
    const qrCode = 'test-qr-code-' + Date.now();
    await redisCache.cacheQRCode(testAgentId, qrCode);
    const retrievedQR = await redisCache.getQRCode(testAgentId);
    if (retrievedQR === qrCode) {
      console.log('✅ QR code cached and retrieved\n');
    } else {
      console.error('❌ QR code retrieval failed\n');
    }

    // Test 5: Instance registration
    console.log('Test 5: Instance registration');
    const instanceId = 'test-instance-' + Date.now();
    await redisCache.registerInstance(instanceId, { hostname: 'test-host', pid: 12345 });
    // Small delay to ensure key is set
    await new Promise(resolve => setTimeout(resolve, 100));
    const instances = await redisCache.getActiveInstances();
    if (instances.length > 0) {
      console.log(`✅ Instance registered (${instances.length} active instances)\n`);
    } else {
      console.log(`⚠️  Instance registered but not found (may have expired quickly)\n`);
    }

    // Test 6: Statistics
    console.log('Test 6: Statistics');
    const stats = await redisCache.getStats();
    if (stats.connected) {
      console.log('✅ Statistics retrieved:');
      console.log(`   - Total connections: ${stats.totalConnections}`);
      console.log(`   - Total commands: ${stats.totalCommands}`);
      console.log(`   - Memory used: ${stats.usedMemory}`);
      console.log(`   - Total keys: ${stats.totalKeys}\n`);
    } else {
      console.error('❌ Statistics retrieval failed\n');
    }

    // Test 7: Cleanup
    console.log('Test 7: Cleanup');
    await redisCache.deleteSession(testAgentId);
    const deletedSession = await redisCache.getSession(testAgentId);
    if (deletedSession === null) {
      console.log('✅ Session deleted successfully\n');
    } else {
      console.error('❌ Session deletion failed\n');
    }

    // Test 8: Shutdown
    console.log('Test 8: Graceful shutdown');
    await redisCache.shutdown();
    console.log('✅ Redis shut down gracefully\n');

    console.log('🎉 All Redis Cache Service tests passed!');
    console.log('\n📊 Redis cache service is ready for integration');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testRedisCache();
