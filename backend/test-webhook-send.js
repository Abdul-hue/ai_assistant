/**
 * Test script for webhook send message endpoint
 * 
 * Usage:
 *   node test-webhook-send.js <agentId> <phoneNumber> <message>
 * 
 * Example:
 *   node test-webhook-send.js b361a914-18bb-405c-92eb-8afe549ca9e1 923336906200 "Test message"
 */

const http = require('http');

const AGENT_ID = process.argv[2] || 'b361a914-18bb-405c-92eb-8afe549ca9e1';
const PHONE_NUMBER = process.argv[3] || '923336906200';
const MESSAGE = process.argv[4] || 'Hello, this is a test message from webhook!';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || 'localhost';

const requestData = JSON.stringify({
  agentId: AGENT_ID,
  to: PHONE_NUMBER,
  message: MESSAGE
});

const options = {
  hostname: HOST,
  port: PORT,
  path: '/api/webhooks/send-message',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData),
    'X-Request-ID': `test-${Date.now()}`
  }
};

console.log('\n🧪 Testing Webhook Send Message Endpoint');
console.log('==========================================');
console.log(`Agent ID: ${AGENT_ID}`);
console.log(`To: ${PHONE_NUMBER}`);
console.log(`Message: ${MESSAGE}`);
console.log(`URL: http://${HOST}:${PORT}${options.path}`);
console.log('==========================================\n');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log(`Status Message: ${res.statusMessage}`);
    console.log('\nResponse:');
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
      
      if (json.success) {
        console.log('\n✅ SUCCESS: Message sent successfully!');
      } else {
        console.log('\n❌ FAILED:', json.error || json.details);
        if (json.action_required) {
          console.log(`Action Required: ${json.action_required}`);
        }
        if (json.qr_code) {
          console.log('QR Code available - agent needs to scan QR code');
        }
      }
    } catch (e) {
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request Error:', error.message);
  console.error('\nMake sure the backend server is running on port', PORT);
});

req.write(requestData);
req.end();

