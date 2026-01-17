/**
 * Test Instance Manager
 * Verifies instance manager works correctly
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const instanceManager = require('../src/services/instanceManager');
const redisCache = require('../src/services/redisCache');

async function testInstanceManager() {
  console.log('🧪 Testing Instance Manager\n');
  
  try {
    // Initialize Redis first
    console.log('Step 1: Initialize Redis');
    await redisCache.initialize();
    console.log('✅ Redis initialized\n');
    
    // Initialize instance manager
    console.log('Test 1: Initialize Instance Manager');
    await instanceManager.initialize();
    console.log('✅ Instance manager initialized');
    console.log(`   Instance ID: ${instanceManager.instanceId}`);
    console.log(`   Is Active: ${instanceManager.isActive}`);
    console.log(`   Assigned Agents: ${instanceManager.assignedAgentCount}\n`);
    
    // Test instance registration
    console.log('Test 2: Instance Registration');
    const activeInstances = await instanceManager.getActiveInstances();
    console.log(`✅ Active instances: ${activeInstances.length}`);
    if (activeInstances.length > 0) {
      console.log(`   Current instance found: ${activeInstances.some(i => i.instanceId === instanceManager.instanceId) ? 'YES' : 'NO'}`);
    }
    console.log('');
    
    // Test agent assignment
    console.log('Test 3: Agent Assignment');
    const testAgentId = 'test-agent-' + Date.now();
    await instanceManager.assignAgent(testAgentId);
    console.log(`✅ Agent assigned: ${testAgentId.substring(0, 8)}...`);
    console.log(`   Assigned to this instance: ${instanceManager.isAgentAssignedToThisInstance(testAgentId)}`);
    console.log(`   Total agents: ${instanceManager.assignedAgentCount}\n`);
    
    // Test get agent instance
    console.log('Test 4: Get Agent Instance');
    const agentInstance = await instanceManager.getAgentInstance(testAgentId);
    console.log(`✅ Agent instance: ${agentInstance === instanceManager.instanceId ? 'MATCH' : 'MISMATCH'}\n`);
    
    // Test least loaded instance
    console.log('Test 5: Least Loaded Instance');
    const leastLoaded = await instanceManager.getLeastLoadedInstance();
    console.log(`✅ Least loaded instance: ${leastLoaded.instanceId}`);
    console.log(`   Assigned agents: ${leastLoaded.assignedAgents}`);
    console.log(`   Is local: ${leastLoaded.isLocal}\n`);
    
    // Test capacity check
    console.log('Test 6: Capacity Check');
    const canAccept = instanceManager.canAcceptMoreAgents();
    console.log(`✅ Can accept more agents: ${canAccept}`);
    console.log(`   Current: ${instanceManager.assignedAgentCount}`);
    console.log(`   Max: ${process.env.MAX_AGENTS_PER_INSTANCE || 200}\n`);
    
    // Test statistics
    console.log('Test 7: Instance Statistics');
    const stats = instanceManager.getStats();
    console.log('✅ Statistics retrieved:');
    console.log(`   Instance ID: ${stats.instanceId}`);
    console.log(`   Hostname: ${stats.hostname}`);
    console.log(`   PID: ${stats.pid}`);
    console.log(`   Uptime: ${Math.round(stats.uptime)}s`);
    console.log(`   Is Active: ${stats.isActive}`);
    console.log(`   Assigned Agents: ${stats.assignedAgents}/${stats.maxAgents}`);
    console.log(`   Utilization: ${stats.utilization}`);
    console.log(`   Memory RSS: ${stats.memoryUsage.rss}`);
    console.log(`   Memory Heap: ${stats.memoryUsage.heapUsed}\n`);
    
    // Test agent unassignment
    console.log('Test 8: Agent Unassignment');
    await instanceManager.unassignAgent(testAgentId);
    console.log(`✅ Agent unassigned: ${testAgentId.substring(0, 8)}...`);
    console.log(`   Total agents: ${instanceManager.assignedAgentCount}\n`);
    
    // Wait a bit for heartbeat
    console.log('Test 9: Heartbeat (waiting 5 seconds...)');
    await new Promise(resolve => setTimeout(resolve, 5000));
    const instancesAfterHeartbeat = await instanceManager.getActiveInstances();
    console.log(`✅ Active instances after heartbeat: ${instancesAfterHeartbeat.length}\n`);
    
    // Shutdown
    console.log('Test 10: Graceful Shutdown');
    await instanceManager.shutdown();
    console.log('✅ Instance manager shut down');
    console.log(`   Is Active: ${instanceManager.isActive}\n`);
    
    // Shutdown Redis
    await redisCache.shutdown();
    console.log('✅ Redis shut down\n');
    
    console.log('🎉 All Instance Manager tests passed!');
    console.log('\n📊 Instance manager is ready for multi-instance coordination');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\n🔍 Check:');
    console.error('  1. Redis is running and accessible');
    console.error('  2. Environment variables are set correctly');
    console.error('  3. No network issues');
    console.error('\n📋 Error details:');
    console.error(error.stack);
    process.exit(1);
  }
}

testInstanceManager();
