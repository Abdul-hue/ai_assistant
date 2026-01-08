#!/usr/bin/env node

/**
 * Real-time message monitoring script
 * Monitors the enhanced message handler and shows live activity
 */

require('dotenv').config();
const pool = require('./src/database');

console.log('🔍 Message Handler Monitor');
console.log('=' .repeat(50));
console.log('Monitoring message flow in real-time...');
console.log('Press Ctrl+C to stop monitoring\n');

// Function to get recent messages
async function getRecentMessages() {
  try {
    const result = await pool.query(`
      SELECT 
        agent_id,
        from_number,
        message_text,
        message_type,
        direction,
        created_at,
        message_id
      FROM chat_messages 
      WHERE created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    return result.rows;
  } catch (error) {
    console.error('❌ Database error:', error.message);
    return [];
  }
}

// Function to get recent webhook logs
async function getRecentWebhooks() {
  try {
    const result = await pool.query(`
      SELECT 
        agent_id,
        webhook_url,
        response_status,
        error_message,
        created_at
      FROM n8n_webhook_logs 
      WHERE created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    return result.rows;
  } catch (error) {
    console.error('❌ Database error:', error.message);
    return [];
  }
}

// Function to display status
async function displayStatus() {
  console.clear();
  console.log('🔍 Message Handler Monitor - ' + new Date().toLocaleTimeString());
  console.log('=' .repeat(60));
  
  // Get recent messages
  const messages = await getRecentMessages();
  console.log(`\n📨 Recent Messages (${messages.length} in last 5 minutes):`);
  console.log('-'.repeat(40));
  
  if (messages.length === 0) {
    console.log('   No recent messages found');
  } else {
    messages.forEach((msg, index) => {
      const time = new Date(msg.created_at).toLocaleTimeString();
      const content = msg.message_text.length > 50 
        ? msg.message_text.substring(0, 50) + '...' 
        : msg.message_text;
      const status = msg.direction === 'incoming' ? '📥' : '📤';
      console.log(`   ${index + 1}. ${status} ${msg.from_number} → ${msg.message_type} (${time})`);
      console.log(`      "${content}"`);
    });
  }
  
  // Get recent webhooks
  const webhooks = await getRecentWebhooks();
  console.log(`\n🔗 Recent Webhooks (${webhooks.length} in last 5 minutes):`);
  console.log('-'.repeat(40));
  
  if (webhooks.length === 0) {
    console.log('   No recent webhook activity');
  } else {
    webhooks.forEach((webhook, index) => {
      const time = new Date(webhook.created_at).toLocaleTimeString();
      const status = webhook.response_status === 200 ? '✅' : '❌';
      const statusText = webhook.response_status === 200 ? 'SUCCESS' : `FAILED (${webhook.response_status})`;
      console.log(`   ${index + 1}. ${status} Agent ${webhook.agent_id} → ${statusText} (${time})`);
      if (webhook.error_message) {
        console.log(`      Error: ${webhook.error_message}`);
      }
    });
  }
  
  // Show summary
  const successWebhooks = webhooks.filter(w => w.response_status === 200).length;
  const failedWebhooks = webhooks.filter(w => w.response_status !== 200).length;
  
  console.log(`\n📊 Summary:`);
  console.log(`   Messages: ${messages.length}`);
  console.log(`   Webhooks: ${successWebhooks} success, ${failedWebhooks} failed`);
  
  if (failedWebhooks > 0) {
    console.log(`\n⚠️  ${failedWebhooks} webhook(s) failed - check configuration`);
  }
  
  console.log('\n💡 Tips:');
  console.log('   - Send a WhatsApp message to test the flow');
  console.log('   - Check server logs for detailed information');
  console.log('   - Verify webhook URL is correct');
  console.log('\nPress Ctrl+C to stop monitoring...');
}

// Start monitoring
let intervalId;

async function startMonitoring() {
  await displayStatus();
  intervalId = setInterval(displayStatus, 5000); // Update every 5 seconds
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Stopping monitor...');
  if (intervalId) {
    clearInterval(intervalId);
  }
  process.exit(0);
});

// Start the monitor
startMonitoring().catch(error => {
  console.error('❌ Monitor error:', error.message);
  process.exit(1);
});
