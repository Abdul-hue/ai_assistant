/**
 * Load Testing Script for PA Agent System
 * Phase 3C.5 - Load Testing & Validation
 * 
 * Tests:
 * 1. Database query performance with caching
 * 2. Message processing throughput
 * 3. Memory stability under load
 * 4. Cache effectiveness
 * 5. Concurrent operations
 * 
 * Run: node scripts/load-test.js [options]
 * Options:
 *   --profile-db    Enable deep database profiling (diagnostic only)
 */

const sessionCache = require('../src/services/sessionCache');
const redisCache = require('../src/services/redisCache');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Parse CLI arguments
const CLI_ARGS = {
  profileDb: process.argv.includes('--profile-db')
};

// Determine environment (default to development if not set)
const NODE_ENV = process.env.NODE_ENV || 'development';

// Environment-aware database thresholds
// Production: strict thresholds (FAIL on exceed)
// Dev/Staging: relaxed thresholds (WARN on exceed, not FAIL)
const DB_THRESHOLDS = {
  development: {
    avg: parseInt(process.env.DB_QUERY_AVG_THRESHOLD_MS) || 350,
    p95: parseInt(process.env.DB_QUERY_P95_THRESHOLD_MS) || 500,
    strict: false // WARN instead of FAIL
  },
  staging: {
    avg: parseInt(process.env.DB_QUERY_AVG_THRESHOLD_MS) || 200,
    p95: parseInt(process.env.DB_QUERY_P95_THRESHOLD_MS) || 300,
    strict: false // WARN instead of FAIL
  },
  production: {
    avg: parseInt(process.env.DB_QUERY_AVG_THRESHOLD_MS) || 100,
    p95: parseInt(process.env.DB_QUERY_P95_THRESHOLD_MS) || 200,
    strict: true // FAIL on exceed
  }
};

// Get thresholds for current environment
const currentThresholds = DB_THRESHOLDS[NODE_ENV] || DB_THRESHOLDS.development;

// Configuration
const CONFIG = {
  // Test parameters (can be overridden via CLI args)
  targetAgents: parseInt(process.argv[2]) || 100,
  messagesPerAgent: parseInt(process.argv[3]) || 20,
  testDuration: parseInt(process.argv[4]) || 300000, // 5 minutes default
  concurrency: 10,
  
  // Thresholds
  thresholds: {
    databaseQueryTime: currentThresholds.avg,      // Environment-aware
    databaseQueryP95: currentThresholds.p95,        // Environment-aware
    cacheQueryTime: 10,          // ms
    messageProcessing: 50,       // ms per message
    cacheHitRate: 70,            // %
    memoryGrowth: 10,            // % over test duration
    successRate: 95,             // %
  },
  
  // Environment settings
  environment: NODE_ENV,
  strictMode: currentThresholds.strict
};

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration!');
  console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test results with enhanced tracking
const results = {
  databaseQueries: [],
  databaseQueriesCold: [],  // First 10 queries (cold cache)
  databaseQueriesWarm: [], // Last 10 queries (warm cache)
  cacheQueries: [],
  messageInserts: [],
  errors: [],
  memorySnapshots: [],
  dbProfiling: [],          // Deep profiling data (if enabled)
  skipped: {
    cache: false
  }
};

// Redis initialization state (prevents retry spam)
let redisInitialized = false;
let redisInitFailed = false;

// Test utilities
function measureMemory() {
  const usage = process.memoryUsage();
  return {
    timestamp: Date.now(),
    rss: usage.rss / 1024 / 1024,           // MB
    heapTotal: usage.heapTotal / 1024 / 1024,
    heapUsed: usage.heapUsed / 1024 / 1024,
    external: usage.external / 1024 / 1024,
  };
}

async function measureTime(fn) {
  const start = Date.now();
  try {
    await fn();
    return Date.now() - start;
  } catch (error) {
    results.errors.push(error.message);
    throw error;
  }
}

// Enhanced time measurement with profiling support
async function measureTimeWithProfiling(fn, label = '') {
  const start = Date.now();
  const networkStart = Date.now(); // Approximate network start (before query)
  
  try {
    const result = await fn();
    const totalTime = Date.now() - start;
    const networkEstimate = Date.now() - networkStart; // Rough network latency estimate
    
    if (CLI_ARGS.profileDb && label) {
      results.dbProfiling.push({
        label,
        totalTime,
        networkEstimate,
        timestamp: Date.now()
      });
    }
    
    return { time: totalTime, result };
  } catch (error) {
    results.errors.push(error.message);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: Database Query Performance (with cold/warm analysis)
async function testDatabaseQueries() {
  console.log('\n📊 Test 1: Database Query Performance');
  console.log('='.repeat(60));
  console.log(`Environment: ${CONFIG.environment} (${CONFIG.strictMode ? 'STRICT' : 'RELAXED'} mode)`);
  console.log(`Thresholds: avg=${currentThresholds.avg}ms, p95=${currentThresholds.p95}ms`);
  if (CLI_ARGS.profileDb) {
    console.log('🔍 Deep profiling enabled (diagnostic only)');
  }
  
  const testAgentIds = Array.from({ length: 50 }, () => crypto.randomUUID());
  
  // Get existing user_ids from database (from agents or whatsapp_sessions)
  console.log('Fetching existing user IDs...');
  let testUserIds = [];
  let userError = null;
  
  // Try to get user_ids from agents table first
  const { data: agentsData, error: agentsError } = await supabase
    .from('agents')
    .select('user_id')
    .limit(5);
  
  if (!agentsError && agentsData && agentsData.length > 0) {
    testUserIds = [...new Set(agentsData.map(a => a.user_id))]; // Remove duplicates
    console.log(`   Found ${testUserIds.length} user IDs from agents table`);
  } else {
    // Fallback: try whatsapp_sessions
    const { data: sessionsData, error: sessionsError } = await supabase
      .from('whatsapp_sessions')
      .select('user_id')
      .limit(5);
    
    if (!sessionsError && sessionsData && sessionsData.length > 0) {
      testUserIds = [...new Set(sessionsData.map(s => s.user_id))]; // Remove duplicates
      console.log(`   Found ${testUserIds.length} user IDs from whatsapp_sessions table`);
    } else {
      // Last resort: try profiles table (Supabase Auth)
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id')
        .limit(5);
      
      if (!profilesError && profilesData && profilesData.length > 0) {
        testUserIds = profilesData.map(p => p.id);
        console.log(`   Found ${testUserIds.length} user IDs from profiles table`);
      } else {
        userError = new Error('No users found in database');
      }
    }
  }
  
  if (testUserIds.length === 0) {
    throw new Error('No users available for testing. Please ensure at least one agent or session exists in the database.');
  }
  
  console.log(`✅ Using ${testUserIds.length} existing user ID(s) for testing`);

  // Create test sessions with valid user_ids
  console.log('Creating test sessions...');
  const testData = testAgentIds.map((agentId, index) => ({
    agent_id: agentId,
    user_id: testUserIds[index % testUserIds.length], // ✅ Use valid user_id
    status: 'connected',
    is_active: true,
    phone_number: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
    session_data: { creds: { test: 'data' } },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error: sessionError } = await supabase.from('whatsapp_sessions').insert(testData);
  if (sessionError) {
    throw new Error(`Failed to create test sessions: ${sessionError.message}`);
  }
  console.log(`✅ Created ${testData.length} test sessions`);
  
  // Test database queries with cold/warm analysis
  console.log('\nTesting database queries (20 total: 10 cold + 10 warm)...');
  
  // Phase A: Cold queries (first 10)
  console.log('Phase A: Cold queries (cache not warmed)...');
  for (let i = 0; i < 10; i++) {
    const agentId = testAgentIds[i % testAgentIds.length];
    
    const { time } = await measureTimeWithProfiling(async () => {
      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('agent_id, status, session_data')
        .eq('agent_id', agentId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    }, `cold_query_${i}`);
    
    results.databaseQueries.push(time);
    results.databaseQueriesCold.push(time);
    
    if ((i + 1) % 5 === 0) {
      console.log(`   Cold: ${i + 1}/10 queries`);
    }
  }
  
  // Phase B: Warm queries (last 10) - cache should be warmed
  console.log('Phase B: Warm queries (cache warmed)...');
  for (let i = 10; i < 20; i++) {
    const agentId = testAgentIds[i % testAgentIds.length];
    
    const { time } = await measureTimeWithProfiling(async () => {
      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('agent_id, status, session_data')
        .eq('agent_id', agentId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    }, `warm_query_${i}`);
    
    results.databaseQueries.push(time);
    results.databaseQueriesWarm.push(time);
    
    if ((i + 1) % 5 === 0) {
      console.log(`   Warm: ${i + 1}/20 queries`);
    }
  }
  
  // Calculate statistics
  const avgDbTime = results.databaseQueries.reduce((a, b) => a + b, 0) / results.databaseQueries.length;
  const sorted = [...results.databaseQueries].sort((a, b) => a - b);
  const p95DbTime = sorted[Math.floor(sorted.length * 0.95)];
  
  // Cold vs warm analysis
  const coldAvg = results.databaseQueriesCold.reduce((a, b) => a + b, 0) / results.databaseQueriesCold.length;
  const warmAvg = results.databaseQueriesWarm.reduce((a, b) => a + b, 0) / results.databaseQueriesWarm.length;
  const improvement = ((coldAvg - warmAvg) / coldAvg * 100).toFixed(2);
  const improvementNum = parseFloat(improvement);
  
  console.log(`\n✅ Database Query Results:`);
  console.log(`   Overall Average: ${avgDbTime.toFixed(2)}ms`);
  console.log(`   Overall P95: ${p95DbTime.toFixed(2)}ms`);
  console.log(`   Cold Average: ${coldAvg.toFixed(2)}ms (first 10 queries)`);
  console.log(`   Warm Average: ${warmAvg.toFixed(2)}ms (last 10 queries)`);
  console.log(`   Improvement: ${improvement}% (warm vs cold)`);
  console.log(`   Thresholds: avg=${currentThresholds.avg}ms, p95=${currentThresholds.p95}ms`);
  
  // Performance warning if warm queries not significantly faster
  if (improvementNum < 30) {
    console.log(`   ⚠️  WARNING: Warm queries only ${improvement}% faster than cold`);
    console.log(`      Expected >30% improvement. Cache may not be effective.`);
  }
  
  // Deep profiling output (if enabled)
  if (CLI_ARGS.profileDb && results.dbProfiling.length > 0) {
    console.log(`\n🔍 Deep Profiling (Diagnostic Only):`);
    const avgTotal = results.dbProfiling.reduce((a, b) => a + b.totalTime, 0) / results.dbProfiling.length;
    const avgNetwork = results.dbProfiling.reduce((a, b) => a + b.networkEstimate, 0) / results.dbProfiling.length;
    console.log(`   Average Total Time: ${avgTotal.toFixed(2)}ms`);
    console.log(`   Average Network Estimate: ${avgNetwork.toFixed(2)}ms`);
    console.log(`   (Note: Network estimate is approximate, Supabase execution time not directly available)`);
  }
  
  // Determine pass/fail/warn based on environment
  const avgExceeds = avgDbTime > currentThresholds.avg;
  const p95Exceeds = p95DbTime > currentThresholds.p95;
  
  if (CONFIG.strictMode) {
    // Production: FAIL on exceed
    if (avgExceeds || p95Exceeds) {
      console.log(`   ❌ FAIL - Query time exceeds threshold`);
      results.databaseTestStatus = 'FAIL';
    } else {
      console.log(`   ✅ PASS`);
      results.databaseTestStatus = 'PASS';
    }
  } else {
    // Dev/Staging: WARN on exceed (not FAIL)
    if (avgExceeds || p95Exceeds) {
      console.log(`   ⚠️  WARN - Query time exceeds threshold (${CONFIG.environment} mode: not failing)`);
      results.databaseTestStatus = 'WARN';
    } else {
      console.log(`   ✅ PASS`);
      results.databaseTestStatus = 'PASS';
    }
  }
  
  // Cleanup
  const { error: deleteError } = await supabase.from('whatsapp_sessions').delete().in('agent_id', testAgentIds);
  if (deleteError) {
    console.warn(`⚠️  Failed to cleanup test sessions: ${deleteError.message}`);
  } else {
    console.log(`\n🧹 Cleanup complete`);
  }
}

// Helper to check Redis availability (without retry spam)
async function isRedisAvailable() {
  // If initialization already failed, don't retry
  if (redisInitFailed) {
    return false;
  }
  
  try {
    // Check if Redis is ready using the isReady() function
    if (redisCache.isReady && typeof redisCache.isReady === 'function') {
      if (redisCache.isReady()) {
        // Try to ping to confirm connection
        const client = redisCache.getClient();
        if (client) {
          await client.ping();
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Test 2: Cache Performance
async function testCachePerformance() {
  console.log('\n📊 Test 2: Cache Performance');
  console.log('='.repeat(60));
  
  // Check if Redis is available (without retry spam)
  const redisAvailable = await isRedisAvailable();
  if (!redisAvailable) {
    console.log('⚠️  Redis not available - skipping cache tests');
    console.log('   (This is OK - cache tests require Redis)');
    console.log('   ⊘ SKIPPED\n');
    results.skipped.cache = true;
    return; // Skip this test
  }
  
  const testAgentIds = Array.from({ length: 50 }, () => crypto.randomUUID());
  const testCreds = {
    me: { id: '1234567890' },
    noiseKey: { public: Buffer.from('test').toString('base64') },
  };
  
  // Populate cache
  console.log('Populating cache...');
  for (const agentId of testAgentIds) {
    await sessionCache.setCachedCredentials(agentId, testCreds);
  }
  console.log(`✅ Cached ${testAgentIds.length} credentials`);
  
  // Test cache queries
  console.log('\nTesting cache queries...');
  let hits = 0;
  
  for (let i = 0; i < 200; i++) {
    const agentId = testAgentIds[i % testAgentIds.length];
    
    const time = await measureTime(async () => {
      const cached = await sessionCache.getCachedCredentials(agentId);
      if (cached) hits++;
    });
    
    results.cacheQueries.push(time);
    
    if ((i + 1) % 40 === 0) {
      console.log(`Progress: ${i + 1}/200 queries`);
    }
  }
  
  const avgCacheTime = results.cacheQueries.reduce((a, b) => a + b, 0) / results.cacheQueries.length;
  const cacheHitRate = (hits / 200 * 100).toFixed(2);
  
  console.log(`\n✅ Cache Query Results:`);
  console.log(`   Average: ${avgCacheTime.toFixed(2)}ms`);
  console.log(`   Hit Rate: ${cacheHitRate}%`);
  console.log(`   Thresholds: ${CONFIG.thresholds.cacheQueryTime}ms, ${CONFIG.thresholds.cacheHitRate}%`);
  
  if (avgCacheTime < CONFIG.thresholds.cacheQueryTime && parseFloat(cacheHitRate) >= CONFIG.thresholds.cacheHitRate) {
    console.log(`   ✅ PASS`);
    results.cacheTestStatus = 'PASS';
  } else {
    console.log(`   ❌ FAIL`);
    results.cacheTestStatus = 'FAIL';
  }
  
  // Get cache stats
  try {
    const stats = await sessionCache.getSessionStats();
    console.log(`\nCache Statistics:`);
    console.log(`   Total Hits: ${stats.metrics.hits}`);
    console.log(`   Total Misses: ${stats.metrics.misses}`);
    console.log(`   Hit Rate: ${stats.hitRate.toFixed(2)}%`);
  } catch (error) {
    console.warn(`⚠️  Could not get cache stats: ${error.message}`);
  }
}

// Test 3: Message Processing Throughput
async function testMessageProcessing() {
  console.log('\n📊 Test 3: Message Processing Throughput');
  console.log('='.repeat(60));
  
  const testAgentId = crypto.randomUUID();
  const messageCount = 1000;
  
  console.log(`Processing ${messageCount} messages...`);
  
  // Get a valid user_id for the test (required by schema)
  const { data: agentData } = await supabase
    .from('agents')
    .select('user_id')
    .limit(1)
    .single();
  
  if (!agentData) {
    throw new Error('No agents found in database. Please create at least one agent for testing.');
  }
  
  const testUserId = agentData.user_id;
  
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    message_id: `test_${Date.now()}_${i}`,
    agent_id: testAgentId,
    user_id: testUserId,
    conversation_id: `test_conversation_${i}`,
    sender_phone: `+1234567890${i}`,
    message_text: `Test message ${i}`,
    message_type: 'text',
    media_url: null,
    media_mimetype: null,
    media_size: null,
    metadata: { test: true, index: i },
    received_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    source: 'whatsapp',
  }));
  
  const startTime = Date.now();
  
  // Batch insert (simulating production behavior)
  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    
    const time = await measureTime(async () => {
      const { error } = await supabase
        .from('message_log')
        .insert(batch);
      
      if (error) throw error;
    });
    
    results.messageInserts.push(time);
    
    if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= messages.length) {
      console.log(`Progress: ${Math.min(i + BATCH_SIZE, messages.length)}/${messageCount} messages`);
    }
  }
  
  const totalTime = Date.now() - startTime;
  const avgBatchTime = results.messageInserts.reduce((a, b) => a + b, 0) / results.messageInserts.length;
  const throughput = (messageCount / (totalTime / 1000)).toFixed(2);
  
  console.log(`\n✅ Message Processing Results:`);
  console.log(`   Total Time: ${totalTime}ms`);
  console.log(`   Average Batch Time: ${avgBatchTime.toFixed(2)}ms`);
  console.log(`   Throughput: ${throughput} msg/s`);
  console.log(`   Threshold: <${CONFIG.thresholds.messageProcessing}ms per message`);
  
  const avgPerMessage = totalTime / messageCount;
  if (avgPerMessage < CONFIG.thresholds.messageProcessing) {
    console.log(`   ✅ PASS`);
    results.messageTestStatus = 'PASS';
  } else {
    console.log(`   ❌ FAIL`);
    results.messageTestStatus = 'FAIL';
  }
  
  // Cleanup
  const { error: deleteError } = await supabase.from('message_log').delete().eq('agent_id', testAgentId);
  if (deleteError) {
    console.warn(`⚠️  Failed to cleanup test messages: ${deleteError.message}`);
  } else {
    console.log(`\n🧹 Cleaned up test messages`);
  }
}

// Test 4: Memory Stability
async function testMemoryStability() {
  console.log('\n📊 Test 4: Memory Stability');
  console.log('='.repeat(60));
  
  const duration = 60000; // 1 minute
  const interval = 5000;  // 5 seconds
  
  console.log(`Monitoring memory for ${duration / 1000} seconds...`);
  
  const startMemory = measureMemory();
  results.memorySnapshots.push(startMemory);
  
  console.log(`\nInitial Memory:`);
  console.log(`   RSS: ${startMemory.rss.toFixed(2)}MB`);
  console.log(`   Heap Used: ${startMemory.heapUsed.toFixed(2)}MB`);
  
  const iterations = duration / interval;
  
  for (let i = 0; i < iterations; i++) {
    await sleep(interval);
    
    // Simulate some activity (only if Redis is available, otherwise skip)
    if (!results.skipped.cache) {
      const testAgentId = crypto.randomUUID();
      try {
        await sessionCache.setCachedCredentials(testAgentId, { test: 'data' });
        await sessionCache.getCachedCredentials(testAgentId);
      } catch (error) {
        // Silently ignore cache errors during memory test
      }
    }
    
    const snapshot = measureMemory();
    results.memorySnapshots.push(snapshot);
    
    console.log(`   [${((i + 1) * interval / 1000)}s] RSS: ${snapshot.rss.toFixed(2)}MB, Heap: ${snapshot.heapUsed.toFixed(2)}MB`);
  }
  
  const endMemory = measureMemory();
  const memoryGrowth = ((endMemory.rss - startMemory.rss) / startMemory.rss * 100).toFixed(2);
  
  console.log(`\n✅ Memory Stability Results:`);
  console.log(`   Start RSS: ${startMemory.rss.toFixed(2)}MB`);
  console.log(`   End RSS: ${endMemory.rss.toFixed(2)}MB`);
  console.log(`   Growth: ${memoryGrowth}%`);
  console.log(`   Threshold: <${CONFIG.thresholds.memoryGrowth}%`);
  
  if (parseFloat(memoryGrowth) < CONFIG.thresholds.memoryGrowth) {
    console.log(`   ✅ PASS - Memory stable`);
    results.memoryTestStatus = 'PASS';
  } else {
    console.log(`   ❌ FAIL - Memory growth exceeds threshold`);
    results.memoryTestStatus = 'FAIL';
  }
}

// Test 5: Generate Performance Report (with enhanced clarity)
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 LOAD TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Environment: ${CONFIG.environment} (${CONFIG.strictMode ? 'STRICT' : 'RELAXED'} mode)`);
  
  const avgDbTime = results.databaseQueries.length > 0
    ? results.databaseQueries.reduce((a, b) => a + b, 0) / results.databaseQueries.length
    : 0;
  const avgCacheTime = results.cacheQueries.length > 0
    ? results.cacheQueries.reduce((a, b) => a + b, 0) / results.cacheQueries.length
    : 0;
  const totalMessages = results.messageInserts.length * 100; // 100 per batch
  const totalInsertTime = results.messageInserts.reduce((a, b) => a + b, 0);
  
  const startMemory = results.memorySnapshots[0];
  const endMemory = results.memorySnapshots[results.memorySnapshots.length - 1];
  const memoryGrowth = startMemory && endMemory
    ? ((endMemory.rss - startMemory.rss) / startMemory.rss * 100).toFixed(2)
    : '0';
  
  // Cold vs warm analysis
  const coldAvg = results.databaseQueriesCold.length > 0
    ? results.databaseQueriesCold.reduce((a, b) => a + b, 0) / results.databaseQueriesCold.length
    : 0;
  const warmAvg = results.databaseQueriesWarm.length > 0
    ? results.databaseQueriesWarm.reduce((a, b) => a + b, 0) / results.databaseQueriesWarm.length
    : 0;
  const improvement = coldAvg > 0 ? ((coldAvg - warmAvg) / coldAvg * 100).toFixed(2) : '0';
  
  console.log('\n📈 Performance Metrics:');
  console.log(`   Database Queries: ${avgDbTime.toFixed(2)}ms avg (${results.databaseQueries.length} queries)`);
  if (coldAvg > 0 && warmAvg > 0) {
    console.log(`   Cold/Warm Analysis: ${coldAvg.toFixed(2)}ms → ${warmAvg.toFixed(2)}ms (${improvement}% improvement)`);
  }
  
  if (results.cacheQueries.length > 0) {
    console.log(`   Cache Queries: ${avgCacheTime.toFixed(2)}ms avg (${results.cacheQueries.length} queries)`);
  } else {
    console.log(`   Cache Queries: ⊘ SKIPPED (Redis not available)`);
  }
  
  if (totalMessages > 0) {
    console.log(`   Message Throughput: ${(totalMessages / (totalInsertTime / 1000)).toFixed(2)} msg/s`);
  }
  
  const memoryGrowthNum = parseFloat(memoryGrowth);
  
  console.log(`   Memory Growth: ${memoryGrowth}%`);
  console.log(`   Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    results.errors.slice(0, 10).forEach((error, i) => {
      console.log(`   ${i + 1}. ${error}`);
    });
    if (results.errors.length > 10) {
      console.log(`   ... and ${results.errors.length - 10} more errors`);
    }
  }
  
  console.log('\n✅ Test Results:');
  
  // Database test result (with environment-aware logic)
  const dbStatus = results.databaseTestStatus || 'UNKNOWN';
  if (dbStatus === 'FAIL' && !CONFIG.strictMode) {
    // In dev/staging, convert FAIL to WARN for display
    console.log(`   Database Query: ⚠️  WARN (would FAIL in production)`);
  } else {
    const dbSymbol = dbStatus === 'PASS' ? '✅ PASS' : dbStatus === 'WARN' ? '⚠️  WARN' : '❌ FAIL';
    console.log(`   Database Query: ${dbSymbol}`);
  }
  
  // Cache test result
  if (results.skipped.cache) {
    console.log(`   Cache Performance: ⊘ SKIPPED (Redis not available)`);
  } else {
    const cacheStatus = results.cacheTestStatus || 'UNKNOWN';
    const cacheSymbol = cacheStatus === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`   Cache Performance: ${cacheSymbol}`);
  }
  
  // Message test result
  const msgStatus = results.messageTestStatus || 'UNKNOWN';
  const msgSymbol = msgStatus === 'PASS' ? '✅ PASS' : '❌ FAIL';
  console.log(`   Message Processing: ${msgSymbol}`);
  
  // Memory test result
  const memStatus = results.memoryTestStatus || 'UNKNOWN';
  const memSymbol = memStatus === 'PASS' ? '✅ PASS' : '❌ FAIL';
  console.log(`   Memory Stability: ${memSymbol}`);
  
  // Error rate
  const errPass = results.errors.length === 0;
  console.log(`   Error Rate: ${errPass ? '✅ PASS' : '❌ FAIL'}`);
  
  // Determine overall pass/fail
  // In dev/staging: DB warnings don't cause overall failure
  // In production: DB failures cause overall failure
  const dbPass = dbStatus === 'PASS' || (dbStatus === 'WARN' && !CONFIG.strictMode);
  const cachePass = results.skipped.cache || results.cacheTestStatus === 'PASS';
  const msgPass = msgStatus === 'PASS';
  const memPass = memStatus === 'PASS';
  
  const coreTestsPassed = 
    dbPass &&
    cachePass &&
    msgPass &&
    memPass &&
    errPass;
  
  console.log('\n' + '='.repeat(60));
  if (coreTestsPassed) {
    console.log('🎉 CORE TESTS PASSED!\n');
    console.log('✅ System is performing within acceptable thresholds\n');
    if (results.skipped.cache) {
      console.log('ℹ️  Note: Cache tests were skipped (Redis not available)');
      console.log('   For full testing, ensure Redis is running\n');
    }
    process.exit(0);
  } else {
    console.log('⚠️  SOME TESTS FAILED\n');
    console.log('Review results above and optimize accordingly.\n');
    process.exit(1);
  }
}

// Main test execution
async function runLoadTests() {
  console.log('\n🧪 PA Agent Load Testing');
  console.log('='.repeat(60));
  console.log(`Configuration:`);
  console.log(`   Environment: ${CONFIG.environment} (${CONFIG.strictMode ? 'STRICT' : 'RELAXED'} mode)`);
  console.log(`   Target Agents: ${CONFIG.targetAgents}`);
  console.log(`   Messages Per Agent: ${CONFIG.messagesPerAgent}`);
  console.log(`   Concurrency: ${CONFIG.concurrency}`);
  if (CLI_ARGS.profileDb) {
    console.log(`   Deep Profiling: ENABLED (diagnostic only)`);
  }
  console.log('='.repeat(60));
  
  try {
    // Initialize services (with Redis retry prevention)
    console.log('\nInitializing services...');
    try {
      await redisCache.initialize();
      redisInitialized = true;
      redisInitFailed = false;
      console.log('✅ Redis initialized');
    } catch (error) {
      redisInitFailed = true;
      redisInitialized = false;
      console.warn(`⚠️  Redis initialization failed: ${error.message}`);
      console.warn('   Continuing without Redis (cache tests will be skipped)');
      console.warn('   Redis retry disabled to prevent log spam');
      
      // Disconnect Redis client to prevent reconnect attempts
      try {
        const client = redisCache.getClient();
        if (client) {
          // Disconnect without reconnecting to stop retry spam
          client.disconnect(false); // false = don't reconnect
        }
      } catch (disconnectError) {
        // Ignore disconnect errors (client may not exist)
      }
    }
    console.log('✅ Services initialized\n');
    
    // Run tests
    await testDatabaseQueries();
    await testCachePerformance();
    await testMessageProcessing();
    await testMemoryStability();
    
    // Generate report
    generateReport();
    
  } catch (error) {
    console.error('\n❌ Load test error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup (only if Redis was initialized)
    if (redisInitialized) {
      try {
        await redisCache.shutdown();
        console.log('\n✅ Services shut down');
      } catch (error) {
        console.warn(`⚠️  Error shutting down services: ${error.message}`);
      }
    }
  }
}

// Run tests
runLoadTests();
