/**
 * Script to check button messages in database
 * Usage: node check-button-message.js [agentId]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { supabaseAdmin } = require('./src/config/supabase');

const AGENT_ID = process.argv[2] || 'b361a914-18bb-405c-92eb-8afe549ca9e1';

async function checkButtonMessages() {
  console.log('\n🔍 Checking button messages in database...');
  console.log(`Agent ID: ${AGENT_ID}\n`);

  try {
    // Get recent messages for this agent
    const { data: messages, error } = await supabaseAdmin
      .from('message_log')
      .select('*')
      .eq('agent_id', AGENT_ID)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('❌ Error fetching messages:', error);
      return;
    }

    if (!messages || messages.length === 0) {
      console.log('ℹ️  No messages found for this agent');
      return;
    }

    console.log(`📊 Found ${messages.length} recent message(s)\n`);

    messages.forEach((msg, index) => {
      console.log(`\n--- Message ${index + 1} ---`);
      console.log(`ID: ${msg.message_id || msg.id}`);
      console.log(`Source: ${msg.source || 'null/undefined'}`);
      console.log(`Sender Type: ${msg.sender_type || 'null/undefined'}`);
      console.log(`Is From Me: ${msg.is_from_me}`);
      console.log(`Message Text (first 200 chars):`);
      console.log(msg.message || msg.message_text || '(empty)');
      console.log(`Has Button Pattern (*1, *2, etc): ${/[*]\d+\s+/.test(msg.message || msg.message_text || '')}`);
      console.log(`Created At: ${msg.created_at}`);
    });

    // Check for button messages specifically
    const buttonMessages = messages.filter(msg => {
      const text = msg.message || msg.message_text || '';
      return msg.source === 'dashboard' && 
             msg.sender_type === 'agent' && 
             /[*]\d+\s+/.test(text);
    });

    console.log(`\n✅ Button Messages Found: ${buttonMessages.length}`);
    if (buttonMessages.length > 0) {
      console.log('\nThese messages should show buttons in the dashboard:');
      buttonMessages.forEach((msg, i) => {
        console.log(`\n${i + 1}. Message: ${(msg.message || msg.message_text || '').substring(0, 100)}...`);
        console.log(`   Source: ${msg.source}, Sender Type: ${msg.sender_type}`);
      });
    } else {
      console.log('\n⚠️  No button messages found with correct format!');
      console.log('Expected: source="dashboard", sender_type="agent", message contains "*1 ", "*2 ", etc.');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkButtonMessages().then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

