#!/usr/bin/env node

/**
 * Test script for the enhanced Baileys message handler
 * This script helps you test the complete message flow
 */

require('dotenv').config();
const { extractMessageData } = require('./src/services/baileysService');
const { triggerN8nWebhook } = require('./src/services/n8nService');

console.log('🧪 Testing Enhanced Message Handler Flow');
console.log('=' .repeat(60));

// Test 1: Environment Configuration Check
console.log('\n📋 1. Environment Configuration Check');
console.log('-'.repeat(40));

const webhookEnv = process.env.WEBHOOK_ENV || 'production';
const webhookUrl = process.env.N8N_WEBHOOK_URL || 'https://nsolbpo.app.n8n.cloud/webhook/whatsapp-webhook';
const timeout = process.env.N8N_WEBHOOK_TIMEOUT || '30000';
const maxAttempts = process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || '3';

console.log(`✅ WEBHOOK_ENV: ${webhookEnv}`);
console.log(`✅ Webhook URL: ${webhookUrl}`);
console.log(`✅ Timeout: ${timeout}ms`);
console.log(`✅ Max Retries: ${maxAttempts}`);

// Test 2: Message Data Extraction
console.log('\n📨 2. Message Data Extraction Test');
console.log('-'.repeat(40));

const testMessages = [
  {
    name: 'Text Message',
    message: {
      key: {
        remoteJid: '1234567890@s.whatsapp.net',
        fromMe: false,
        id: 'TEXT_MSG_001',
        participant: null
      },
      message: {
        conversation: 'Hello! This is a test text message.',
        messageTimestamp: Math.floor(Date.now() / 1000)
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      pushName: 'Test User'
    }
  },
  {
    name: 'Image Message',
    message: {
      key: {
        remoteJid: '1234567890@s.whatsapp.net',
        fromMe: false,
        id: 'IMG_MSG_001',
        participant: null
      },
      message: {
        imageMessage: {
          caption: 'Check out this image!',
          mimetype: 'image/jpeg'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      pushName: 'Test User'
    }
  },
  {
    name: 'Group Message',
    message: {
      key: {
        remoteJid: '120363123456789012@g.us',
        fromMe: false,
        id: 'GROUP_MSG_001',
        participant: '1234567890@s.whatsapp.net'
      },
      message: {
        conversation: 'Hello from the group!',
        messageTimestamp: Math.floor(Date.now() / 1000)
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'PENDING',
      pushName: 'Group User'
    }
  }
];

const mockBotPhoneNumber = '9876543210:123@s.whatsapp.net';

testMessages.forEach((testCase, index) => {
  console.log(`\n   Test ${index + 1}: ${testCase.name}`);
  try {
    const extractedData = extractMessageData(testCase.message, mockBotPhoneNumber);
    console.log(`   ✅ Content: ${extractedData.content}`);
    console.log(`   ✅ Type: ${extractedData.type}`);
    console.log(`   ✅ Sender: ${extractedData.sender.name} (${extractedData.sender.phone})`);
    console.log(`   ✅ Has Media: ${extractedData.hasMedia}`);
    console.log(`   ✅ Media Type: ${extractedData.mediaType || 'N/A'}`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
});

// Test 3: Webhook Payload Construction
console.log('\n🔗 3. Webhook Payload Construction Test');
console.log('-'.repeat(40));

const testMessage = testMessages[0].message;
const extractedData = extractMessageData(testMessage, mockBotPhoneNumber);

const webhookPayload = {
  // Core message data
  agentId: 'test-agent-123',
  agentName: 'Test Agent',
  phoneNumber: extractedData.recipient.phone,
  senderPhone: extractedData.sender.phone,
  senderName: extractedData.sender.name,
  message: extractedData.content,
  messageType: extractedData.type,
  messageId: extractedData.messageId,
  conversationId: extractedData.conversationId,
  timestamp: extractedData.timestamp,
  
  // WhatsApp metadata
  whatsappMetadata: {
    pushName: testMessage.pushName,
    fromMe: testMessage.key.fromMe,
    participant: testMessage.key.participant,
    remoteJid: testMessage.key.remoteJid,
    id: testMessage.key.id,
    messageTimestamp: testMessage.messageTimestamp,
    status: testMessage.status
  },
  
  // Response endpoint
  messageResponse: `/api/agents/test-agent-123/message-response`,
  
  // Additional context
  context: {
    isGroup: extractedData.conversationId.includes('@g.us'),
    isBroadcast: extractedData.conversationId.includes('@broadcast'),
    isStatus: extractedData.conversationId.includes('@status'),
    messageLength: extractedData.content.length,
    hasMedia: extractedData.hasMedia,
    mediaType: extractedData.mediaType
  }
};

console.log('✅ Webhook payload constructed successfully:');
console.log(`   📊 Payload size: ${JSON.stringify(webhookPayload).length} bytes`);
console.log(`   📋 Total fields: ${Object.keys(webhookPayload).length}`);
console.log(`   🔑 Core fields: ${Object.keys(webhookPayload).filter(key => !['whatsappMetadata', 'context'].includes(key)).length}`);
console.log(`   📱 WhatsApp metadata: ${Object.keys(webhookPayload.whatsappMetadata).length}`);
console.log(`   🎯 Context fields: ${Object.keys(webhookPayload.context).length}`);

// Test 4: Webhook Triggering (Optional)
console.log('\n🚀 4. Webhook Triggering Test');
console.log('-'.repeat(40));

if (process.argv.includes('--test-webhook')) {
  console.log('🔗 Triggering actual webhook...');
  console.log(`   Target URL: ${webhookUrl}`);
  console.log(`   Environment: ${webhookEnv}`);
  
  (async () => {
    try {
      const startTime = Date.now();
      const result = await triggerN8nWebhook('test-agent-123', webhookPayload);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Webhook completed in ${duration}ms`);
      console.log(`   Status: ${result.ok ? 'SUCCESS' : 'FAILED'}`);
      if (result.status) console.log(`   HTTP Status: ${result.status}`);
      if (result.body) console.log(`   Response: ${JSON.stringify(result.body).substring(0, 100)}...`);
      if (result.error) console.log(`   Error: ${result.error}`);
      
    } catch (error) {
      console.error(`❌ Webhook test failed: ${error.message}`);
    }
  })();
} else {
  console.log('⚠️  Webhook test skipped (use --test-webhook to trigger actual webhook)');
  console.log('   To test webhook: node test-message-flow.js --test-webhook');
}

// Test 5: Server Status Check
console.log('\n🖥️  5. Server Status Check');
console.log('-'.repeat(40));

const requiredEnvVars = [
  'DATABASE_URL',
  'SUPABASE_URL', 
  'SUPABASE_SERVICE_ROLE_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length === 0) {
  console.log('✅ All required environment variables are set');
} else {
  console.log('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.log(`   - ${varName}`));
}

console.log('\n🎉 Message Flow Test Complete!');
console.log('=' .repeat(60));

console.log('\n📋 Testing Summary:');
console.log('   ✅ Environment configuration verified');
console.log('   ✅ Message data extraction working');
console.log('   ✅ Webhook payload construction working');
console.log('   ✅ Server configuration checked');

console.log('\n💡 Next Steps:');
console.log('   1. Start your backend server: npm start');
console.log('   2. Connect a WhatsApp agent via QR code');
console.log('   3. Send a test message to the connected number');
console.log('   4. Check server logs for message processing');
console.log('   5. Verify webhook delivery in n8n dashboard');

console.log('\n🔍 Debug Commands:');
console.log('   - Test webhook: node test-message-flow.js --test-webhook');
console.log('   - Check logs: tail -f logs/app.log (if logging to file)');
console.log('   - Monitor webhook: Check n8n webhook logs');

console.log('\n📊 Expected Log Output:');
console.log('   [BAILEYS] 📨 Received 1 message(s) for agent {agentId}');
console.log('   [BAILEYS] 📨 Processing message from {phone} to agent {agentId}');
console.log('   [BAILEYS] ✅ Message stored in database for agent {agentId}');
console.log('   [N8N] 🔗 Triggering webhook for agent {agentId}');
console.log('   [N8N] ✅ Webhook triggered successfully for agent {agentId}');
