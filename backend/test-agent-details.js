/**
 * Test script for /api/agents/:id/details endpoint
 * 
 * Usage:
 *   1. Start backend: npm run dev
 *   2. Get a valid agent ID from your database
 *   3. Get an auth token (login and check cookies)
 *   4. Run: node test-agent-details.js
 */

require('dotenv').config();
const fetch = require('node-fetch');

const API_URL = process.env.API_URL || 'http://localhost:3001';

// TODO: Replace these with your actual values
const TEST_AGENT_ID = 'YOUR_AGENT_ID_HERE'; // Get from database or /api/agents endpoint
const TEST_TOKEN = 'YOUR_ACCESS_TOKEN_HERE'; // Get from cookies after login

async function testAgentDetails() {
  console.log('\n🧪 Testing Agent Details Endpoint\n');
  console.log('='.repeat(60));

  try {
    // Test 1: Valid agent
    console.log('\n📋 Test 1: Valid Agent with Details');
    console.log('-'.repeat(60));
    
    const response = await fetch(`${API_URL}/api/agents/${TEST_AGENT_ID}/details`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`
      }
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('\n✅ Response received:\n');
      console.log('Agent ID:', data.agent.id);
      console.log('Agent Name:', data.agent.agent_name);
      console.log('Is Active:', data.agent.is_active);
      console.log('\nWhatsApp Session:', data.agent.whatsapp_session ? {
        phone_number: data.agent.whatsapp_session.phone_number,
        is_active: data.agent.whatsapp_session.is_active,
        status: data.agent.whatsapp_session.status,
      } : 'No session');
      console.log('\nStatistics:');
      console.log('  Total Messages:', data.statistics.total_messages);
      console.log('  Last Message:', data.statistics.last_message_at || 'Never');
      
      // Security checks
      console.log('\n🔒 Security Checks:');
      console.log('  session_state exposed?', 'session_state' in (data.agent.whatsapp_session || {}) ? '❌ FAIL' : '✅ PASS');
      console.log('  QR code logic:', 
        data.agent.whatsapp_session?.qr_code ? 
          (data.agent.whatsapp_session.is_active ? '❌ FAIL (showing QR for active)' : '✅ PASS') 
          : '✅ PASS (no QR or not pending)'
      );
      
    } else {
      const errorData = await response.json().catch(() => ({}));
      console.log('❌ Error:', errorData);
    }

    // Test 2: Invalid UUID
    console.log('\n📋 Test 2: Invalid UUID Format');
    console.log('-'.repeat(60));
    
    const invalidResponse = await fetch(`${API_URL}/api/agents/invalid-uuid/details`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`
      }
    });

    console.log(`Status: ${invalidResponse.status}`);
    if (invalidResponse.status === 400) {
      console.log('✅ Correctly rejected invalid UUID');
    } else {
      console.log('❌ Should have returned 400 Bad Request');
    }

    // Test 3: No authentication
    console.log('\n📋 Test 3: No Authentication');
    console.log('-'.repeat(60));
    
    const noAuthResponse = await fetch(`${API_URL}/api/agents/${TEST_AGENT_ID}/details`);
    
    console.log(`Status: ${noAuthResponse.status}`);
    if (noAuthResponse.status === 401) {
      console.log('✅ Correctly rejected unauthenticated request');
    } else {
      console.log('❌ Should have returned 401 Unauthorized');
    }

    // Test 4: Non-existent agent
    console.log('\n📋 Test 4: Non-existent Agent');
    console.log('-'.repeat(60));
    
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    const notFoundResponse = await fetch(`${API_URL}/api/agents/${nonExistentId}/details`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`
      }
    });

    console.log(`Status: ${notFoundResponse.status}`);
    if (notFoundResponse.status === 404) {
      console.log('✅ Correctly returned 404 for non-existent agent');
    } else {
      console.log('❌ Should have returned 404 Not Found');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed\n');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run tests
if (TEST_AGENT_ID === 'YOUR_AGENT_ID_HERE' || TEST_TOKEN === 'YOUR_ACCESS_TOKEN_HERE') {
  console.log('\n⚠️  Please update TEST_AGENT_ID and TEST_TOKEN in the script\n');
  console.log('How to get values:');
  console.log('1. Login to your app');
  console.log('2. Get agent ID from: fetch(\'/api/agents\', {credentials: \'include\'})');
  console.log('3. Get token from DevTools → Application → Cookies → sb_access_token\n');
  process.exit(1);
}

testAgentDetails();

