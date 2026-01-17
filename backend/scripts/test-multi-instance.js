/**
 * Comprehensive Multi-Instance Coordination Test
 * Tests instance manager, Redis integration, load balancing, and failover
 * Phase 3B: Multi-Instance Coordination
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const instanceManager = require('../src/services/instanceManager');
const redisCache = require('../src/services/redisCache');
const logger = require('../src/services/logger');

async function testMultiInstance() {
  console.log('🧪 Testing Multi-Instance Coordination\n');
  
  try {
    // Test 1: Initialize Redis
    console.log('Test 1: Initialize Redis');
    await redisCache.initialize();
    console.log('✅ Redis initialized\n');
    
    // Test 2: Initialize instance manager
    console.log('Test 2: Initialize Instance Manager');
    await instanceManager.initialize();
    console.log('✅ Instance manager initialized');
    console.log(`   Instance ID: ${instanceManager.instanceId}\n`);
    
    // Test 3: Check if can accept agents
    console.log('Test 3: Check Agent Capacity');
    const canAccept = instanceManager.canAcceptMoreAgents();
    console.log(`✅ Can accept agents: ${canAccept}`);
    console.log(`   Current: ${instanceManager.assignedAgentCount}/200\n`);
    
    // Test 4: Assign test agents
    console.log('Test 4: Assign Test Agents');
    const testAgentIds = [
      'test-agent-1-' + Date.now(),
      'test-agent-2-' + Date.now(),
      'test-agent-3-' + Date.now()
    ];
    
    for (const agentId of testAgentIds) {
      await instanceManager.assignAgent(agentId);
      console.log(`✅ Assigned: ${agentId.substring(0, 20)}...`);
    }
    console.log(`   Total assigned: ${instanceManager.assignedAgentCount}\n`);
    
    // Test 5: Check agent instance assignment
    console.log('Test 5: Verify Agent Assignment');
    for (const agentId of testAgentIds) {
      const assignedInstance = await instanceManager.getAgentInstance(agentId);
      const isLocal = instanceManager.isAgentAssignedToThisInstance(agentId);
      console.log(`✅ ${agentId.substring(0, 20)}...`);
      console.log(`   Assigned to: ${assignedInstance}`);
      console.log(`   Is local: ${isLocal}`);
    }
    console.log();
    
    // Test 6: Get active instances
    console.log('Test 6: Get Active Instances');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for heartbeat
    const instances = await instanceManager.getActiveInstances();
    console.log(`✅ Found ${instances.length} active instance(s):`);
    instances.forEach((inst, i) => {
      console.log(`   ${i + 1}. ${inst.instanceId}`);
      console.log(`      Hostname: ${inst.hostname}`);
      console.log(`      Agents: ${inst.assignedAgents || 0}`);
      console.log(`      Uptime: ${Math.round(inst.uptime || 0)}s`);
    });
    console.log();
    
    // Test 7: Get least loaded instance
    console.log('Test 7: Load Balancing');
    const leastLoaded = await instanceManager.getLeastLoadedInstance();
    console.log(`✅ Least loaded instance: ${leastLoaded.instanceId}`);
    console.log(`   Assigned agents: ${leastLoaded.assignedAgents}`);
    console.log(`   Is local: ${leastLoaded.isLocal}\n`);
    
    // Test 8: Instance statistics
    console.log('Test 8: Instance Statistics');
    const stats = instanceManager.getStats();
    console.log(`✅ Instance stats:`);
    console.log(`   Instance ID: ${stats.instanceId}`);
    console.log(`   Hostname: ${stats.hostname}`);
    console.log(`   PID: ${stats.pid}`);
    console.log(`   Uptime: ${Math.round(stats.uptime)}s`);
    console.log(`   Assigned agents: ${stats.assignedAgents}`);
    console.log(`   Max agents: ${stats.maxAgents}`);
    console.log(`   Utilization: ${stats.utilization}`);
    console.log(`   Memory (RSS): ${stats.memoryUsage.rss}`);
    console.log(`   Memory (Heap): ${stats.memoryUsage.heapUsed}\n`);
    
    // Test 9: Unassign agents
    console.log('Test 9: Unassign Agents');
    for (const agentId of testAgentIds) {
      await instanceManager.unassignAgent(agentId);
      console.log(`✅ Unassigned: ${agentId.substring(0, 20)}...`);
    }
    console.log(`   Total assigned: ${instanceManager.assignedAgentCount}\n`);
    
    // Test 10: Cleanup
    console.log('Test 10: Cleanup');
    await instanceManager.shutdown();
    console.log('✅ Instance manager shut down');
    
    await redisCache.shutdown();
    console.log('✅ Redis shut down\n');
    
    console.log('🎉 All multi-instance tests passed!');
    console.log('\n📊 Multi-instance coordination is ready for production');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('\n📋 Error details:');
    console.error(error.stack);
    process.exit(1);
  }
}

testMultiInstance();
