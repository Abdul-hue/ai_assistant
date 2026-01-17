const Redis = require('ioredis');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function testRedis() {
  console.log('🧪 Testing Redis connection...\n');
  
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log(`📡 Connecting to: ${redisUrl.replace(/:[^:@]+@/, ':****@')}\n`);
  
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    enableReadyCheck: true,
    enableOfflineQueue: true,
    connectTimeout: 10000, // Increased for cloud connections
    lazyConnect: false,
    // TLS support for rediss:// connections
    tls: redisUrl.startsWith('rediss://') ? {
      rejectUnauthorized: false // For cloud Redis services
    } : undefined
  });

  // Handle connection errors gracefully
  redis.on('error', (error) => {
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      console.error('\n❌ Cannot connect to Redis server');
      console.error('   Redis is not running or URL is incorrect\n');
    }
  });

  try {
    // Wait for connection
    await redis.ping();
    
    // Test 1: Ping
    console.log('Test 1: Ping');
    const pong = await redis.ping();
    console.log(`✅ Ping response: ${pong}\n`);

    // Test 2: Set/Get
    console.log('Test 2: Set/Get');
    await redis.set('test:key', 'Hello Redis!', 'EX', 10);
    const value = await redis.get('test:key');
    console.log(`✅ Retrieved value: ${value}\n`);

    // Test 3: Hash operations
    console.log('Test 3: Hash operations');
    await redis.hset('test:hash', 'field1', 'value1', 'field2', 'value2');
    const hash = await redis.hgetall('test:hash');
    console.log(`✅ Hash data:`, hash, '\n');

    // Test 4: Expiration
    console.log('Test 4: Expiration');
    const ttl = await redis.ttl('test:key');
    console.log(`✅ TTL remaining: ${ttl} seconds\n`);

    // Test 5: Info
    console.log('Test 5: Redis info');
    const info = await redis.info('server');
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
    console.log(`✅ Redis version: ${version}\n`);

    // Test 6: Cleanup test keys
    console.log('Test 6: Cleanup');
    await redis.del('test:key', 'test:hash');
    console.log(`✅ Test keys cleaned up\n`);

    console.log('🎉 All Redis tests passed!');
    console.log('\n📊 Redis is ready for distributed caching');

  } catch (error) {
    console.error('❌ Redis test failed:', error.message);
    console.error('\n🔍 Troubleshooting:');
    console.error('  1. Check Redis is running: redis-cli ping');
    console.error('  2. Check REDIS_URL in .env (default: redis://localhost:6379)');
    console.error('  3. Check firewall/network access');
    console.error('  4. For Docker: docker ps | grep redis');
    console.error('\n💡 Quick start options:');
    console.error('  Docker: docker run -d -p 6379:6379 redis:7-alpine');
    console.error('  Windows: Download from https://redis.io/download');
    console.error('  macOS: brew install redis && brew services start redis');
    console.error('  Ubuntu: sudo apt install redis-server && sudo systemctl start redis');
    process.exit(1);
  } finally {
    try {
      if (redis.status === 'ready' || redis.status === 'connecting') {
        await redis.quit();
      }
    } catch (e) {
      // Ignore quit errors
    }
    process.exit(0);
  }
}

testRedis();
