/**
 * Enhanced test script for webhook send message endpoint with WhatsApp Button Support
 * Based on Baileys button implementation
 * 
 * Usage:
 *   node test-webhook-send.js [agentId] [phoneNumber] [format]
 * 
 * Formats:
 *   - text: Plain text with button parsing (dashboard)
 *   - buttons: WhatsApp native buttons (for WhatsApp app)
 *   - template: WhatsApp template buttons (urlButton, callButton, quickReplyButton)
 *   - interactive: Interactive menu to choose options
 * 
 * Examples:
 *   node test-webhook-send.js
 *   node test-webhook-send.js b361a914-18bb-405c-92eb-8afe549ca9e1 923336906200 buttons
 *   node test-webhook-send.js b361a914-18bb-405c-92eb-8afe549ca9e1 923336906200 template
 */

const http = require('http');
const readline = require('readline');

// Configuration
const AGENT_ID = process.argv[2] || 'b361a914-18bb-405c-92eb-8afe549ca9e1';
const PHONE_NUMBER = process.argv[3] || '923336906200';
const FORMAT = process.argv[4] || 'interactive';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || 'localhost';

// Message templates
const MESSAGE_TEMPLATES = {
  // Plain text format (works with dashboard button parser)
  text: `👋 Welcome to your *AI Assistant*!

I can help you manage your business communications efficiently.

Please select an option:

*1️⃣ Send Message*
*2️⃣ Schedule Meeting*
*3️⃣ Meetings / Scheduled Meetings*
*4️⃣ Search Documents*
*5️⃣ Add Contact*
*6️⃣ Update in ERP/CRM*

━━━━━━━━━━━━━━━━━━━━━

Reply with the number (1-6) or simply tell me what you need!`,

  // WhatsApp native buttons (as JSON - your backend needs to handle this)
  buttons: JSON.stringify({
    text: "👋 Welcome to your *AI Assistant*!\n\nI can help you manage your business communications efficiently.\n\nPlease select an option:",
    footer: "Powered by AI Assistant",
    buttons: [
      {
        buttonId: 'send_message',
        buttonText: { displayText: '📤 Send Message' },
        type: 1
      },
      {
        buttonId: 'schedule_meeting',
        buttonText: { displayText: '📅 Schedule Meeting' },
        type: 1
      },
      {
        buttonId: 'view_meetings',
        buttonText: { displayText: '📋 View Meetings' },
        type: 1
      }
    ],
    headerType: 1,
    viewOnce: false
  }),

  // WhatsApp template buttons (with URL, call, and quick reply)
  template: JSON.stringify({
    text: "👋 Welcome to your *AI Assistant*!\n\nI can help you manage your business communications efficiently.\n\nChoose an action:",
    footer: "Powered by AI Assistant",
    templateButtons: [
      {
        index: 1,
        urlButton: {
          displayText: '🌐 Visit Website',
          url: 'https://pa.duhanashrah.ai'
        }
      },
      {
        index: 2,
        callButton: {
          displayText: '📞 Call Support',
          phoneNumber: '+923336906200'
        }
      },
      {
        index: 3,
        quickReplyButton: {
          displayText: '📤 Send Message',
          id: 'send_message'
        }
      },
      {
        index: 4,
        quickReplyButton: {
          displayText: '📅 Schedule Meeting',
          id: 'schedule_meeting'
        }
      }
    ],
    viewOnce: false
  }),

  // Simple buttons (3 buttons max - WhatsApp limit)
  buttonsSimple: JSON.stringify({
    text: "👋 *Welcome!*\n\nWhat would you like to do?",
    footer: "Select an option below",
    buttons: [
      { buttonId: '1', buttonText: { displayText: '📤 Send Message' }, type: 1 },
      { buttonId: '2', buttonText: { displayText: '📅 Schedule' }, type: 1 },
      { buttonId: '3', buttonText: { displayText: '📋 Meetings' }, type: 1 }
    ],
    headerType: 1
  }),

  // List message (alternative to buttons)
  list: JSON.stringify({
    text: "👋 Welcome to your *AI Assistant*!\n\nI can help you with:",
    footer: "Powered by AI",
    title: "Main Menu",
    buttonText: "View Options",
    sections: [
      {
        title: "📱 Communication",
        rows: [
          { title: "Send Message", description: "Send a new message", rowId: "send_message" },
          { title: "Schedule Meeting", description: "Book a meeting", rowId: "schedule_meeting" }
        ]
      },
      {
        title: "📊 Management",
        rows: [
          { title: "View Meetings", description: "See scheduled meetings", rowId: "view_meetings" },
          { title: "Search Documents", description: "Find documents", rowId: "search_docs" }
        ]
      },
      {
        title: "⚙️ Settings",
        rows: [
          { title: "Add Contact", description: "Add new contact", rowId: "add_contact" },
          { title: "Update CRM", description: "Update ERP/CRM", rowId: "update_crm" }
        ]
      }
    ]
  })
};

// Send message function
function sendMessage(message, messageFormat) {
  return new Promise((resolve, reject) => {
const requestData = JSON.stringify({
  agentId: AGENT_ID,
  to: PHONE_NUMBER,
      message: message,
      messageType: messageFormat // Optional: to tell backend what type of message
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
    console.log(`Format: ${messageFormat}`);
console.log(`URL: http://${HOST}:${PORT}${options.path}`);
    console.log(`Message Length: ${message.length} characters`);
console.log('==========================================\n');

    // Show message preview (truncated)
    const preview = message.length > 200 ? message.substring(0, 200) + '...' : message;
    console.log('Message Preview:');
    console.log(preview);
    console.log('\n==========================================\n');

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
            console.log('\n📝 Next Steps:');
            if (messageFormat === 'text') {
              console.log('1. Check your dashboard - message should appear');
              console.log('2. Verify buttons are displayed correctly');
              console.log('3. Test clicking the buttons');
            } else {
              console.log('1. Check your WhatsApp on the phone');
              console.log('2. You should see native WhatsApp buttons');
              console.log('3. Test clicking the buttons');
              console.log('4. The button response should come back to n8n');
            }
            console.log('5. Check database message_log table for stored message');
      } else {
        console.log('\n❌ FAILED:', json.error || json.details);
        if (json.action_required) {
              console.log(`⚠️  Action Required: ${json.action_required}`);
        }
        if (json.qr_code) {
              console.log('📱 QR Code available - agent needs to scan QR code');
        }
      }
          resolve(json);
    } catch (e) {
      console.log(data);
          resolve({ error: 'Invalid JSON response', raw: data });
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request Error:', error.message);
  console.error('\nMake sure the backend server is running on port', PORT);
      reject(error);
});

req.write(requestData);
req.end();
  });
}

// Interactive menu
function showInteractiveMenu() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🎯 Interactive Message Test');
  console.log('============================');
  console.log('Select message format to test:\n');
  console.log('1. Plain Text (Dashboard - button parser)');
  console.log('2. WhatsApp Buttons (Native buttons - 3 max)');
  console.log('3. WhatsApp Template (URL, Call, Quick Reply)');
  console.log('4. WhatsApp List (Alternative to buttons)');
  console.log('5. Simple Buttons (3 buttons)');
  console.log('6. Test All Formats (Send all in sequence)');
  console.log('7. Custom Message (Enter your own text)');
  console.log('0. Exit\n');

  rl.question('Choose an option (0-7): ', async (answer) => {
    rl.close();
    
    switch(answer.trim()) {
      case '1':
        await sendMessage(MESSAGE_TEMPLATES.text, 'text');
        break;
      case '2':
        await sendMessage(MESSAGE_TEMPLATES.buttons, 'buttons');
        break;
      case '3':
        await sendMessage(MESSAGE_TEMPLATES.template, 'template');
        break;
      case '4':
        await sendMessage(MESSAGE_TEMPLATES.list, 'list');
        break;
      case '5':
        await sendMessage(MESSAGE_TEMPLATES.buttonsSimple, 'buttonsSimple');
        break;
      case '6':
        console.log('\n🔄 Testing all formats...\n');
        await sendMessage(MESSAGE_TEMPLATES.text, 'text');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sendMessage(MESSAGE_TEMPLATES.buttonsSimple, 'buttonsSimple');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sendMessage(MESSAGE_TEMPLATES.template, 'template');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sendMessage(MESSAGE_TEMPLATES.list, 'list');
        break;
      case '7':
        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        rl2.question('Enter your custom message (or JSON): ', async (customMessage) => {
          rl2.close();
          await sendMessage(customMessage, 'custom');
        });
        return;
      case '0':
        console.log('👋 Goodbye!');
        process.exit(0);
        break;
      default:
        console.log('❌ Invalid option. Please try again.');
        showInteractiveMenu();
    }
  });
}

// Main execution
(async () => {
  if (FORMAT === 'interactive') {
    showInteractiveMenu();
  } else if (FORMAT === 'text') {
    await sendMessage(MESSAGE_TEMPLATES.text, 'text');
  } else if (FORMAT === 'buttons') {
    await sendMessage(MESSAGE_TEMPLATES.buttons, 'buttons');
  } else if (FORMAT === 'template') {
    await sendMessage(MESSAGE_TEMPLATES.template, 'template');
  } else if (FORMAT === 'list') {
    await sendMessage(MESSAGE_TEMPLATES.list, 'list');
  } else if (FORMAT === 'all') {
    console.log('\n🔄 Testing all formats...\n');
    await sendMessage(MESSAGE_TEMPLATES.text, 'text');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await sendMessage(MESSAGE_TEMPLATES.buttonsSimple, 'buttonsSimple');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await sendMessage(MESSAGE_TEMPLATES.template, 'template');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await sendMessage(MESSAGE_TEMPLATES.list, 'list');
  } else {
    // Use custom message from command line
    await sendMessage(FORMAT, 'custom');
  }
})();