/**
 * Test script for WhatsApp button messages
 * 
 * Usage:
 *   node test-button-message.js <agentId> <phoneNumber>
 * 
 * Example:
 *   node test-button-message.js b361a914-18bb-405c-92eb-8afe549ca9e1 923336906200
 */

const http = require('http');

const AGENT_ID = process.argv[2] || 'b361a914-18bb-405c-92eb-8afe549ca9e1';
const PHONE_NUMBER = process.argv[3] || '923336906200';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || 'localhost';

// Button message format (using Interactive Message Native Flow)
// Supports quick_reply, cta_url, and cta_call button types
const BUTTON_MESSAGE = {
  text: '👋 Welcome! Please choose an option:',
  // Optional: title and footer for Interactive Message
  // title: 'Welcome Message', // Optional header title (max 60 chars)
  // footer: 'Powered by WhatsApp', // Optional footer (max 60 chars)
  buttons: [
    { id: 'option_1', text: 'Option 1' }, // quick_reply (default)
    { id: 'option_2', text: 'Option 2' }, // quick_reply (default)
    { id: 'option_3', text: 'Option 3' } // quick_reply (default)
    // Examples of other button types:
    // { id: 'visit_website', text: 'Visit Website', url: 'https://example.com' }, // cta_url
    // { id: 'call_support', text: 'Call Support', phone: '+1234567890' } // cta_call
  ]
};

const requestData = JSON.stringify({
  agentId: AGENT_ID,
  to: PHONE_NUMBER,
  message: BUTTON_MESSAGE
});

const options = {
  hostname: HOST,
  port: PORT,
  path: '/api/webhooks/send-message',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestData),
    'X-Request-ID': `test-button-${Date.now()}`
  }
};

console.log('\n🧪 Testing WhatsApp Button Message');
console.log('==========================================');
console.log(`Agent ID: ${AGENT_ID}`);
console.log(`To: ${PHONE_NUMBER}`);
console.log(`Message Text: ${BUTTON_MESSAGE.text}`);
console.log(`Buttons: ${BUTTON_MESSAGE.buttons.length} button(s)`);
BUTTON_MESSAGE.buttons.forEach((btn, i) => {
  console.log(`  ${i + 1}. [${btn.id}] ${btn.text}`);
});
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
        console.log('\n✅ SUCCESS: Button message sent successfully!');
        console.log('📱 Check WhatsApp to see the buttons');
        console.log('🔘 When user clicks a button, your webhook will receive buttonResponse data');
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

