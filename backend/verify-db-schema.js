/**
 * Script to verify message_log table schema
 * Usage: node verify-db-schema.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { supabaseAdmin } = require('./src/config/supabase');

async function verifySchema() {
  console.log('\n🔍 Verifying message_log table schema...\n');

  try {
    // Try to insert a test message with required fields only
    const testPayload = {
      message_id: `test-${Date.now()}`,
      conversation_id: 'test@s.whatsapp.net',
      sender_phone: '1234567890',
      agent_id: '00000000-0000-0000-0000-000000000000',
      user_id: '00000000-0000-0000-0000-000000000000',
      message_text: 'Test message',
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      message_type: 'text',
      source: 'dashboard',
      sender_type: 'agent',
      is_from_me: false,
      status: 'delivered',
    };

    console.log('📝 Test payload:', JSON.stringify(testPayload, null, 2));

    const { data, error } = await supabaseAdmin
      .from('message_log')
      .insert(testPayload)
      .select()
      .single();

    if (error) {
      console.error('❌ Schema verification failed:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      
      if (error.code === '42703') {
        console.error('\n⚠️  Column does not exist! Check if these columns exist:');
        console.error('  - source');
        console.error('  - sender_type');
        console.error('  - message (new column)');
      }
    } else {
      console.log('✅ Schema verification passed!');
      console.log('📊 Inserted test message:', JSON.stringify(data, null, 2));
      
      // Clean up test message
      await supabaseAdmin
        .from('message_log')
        .delete()
        .eq('message_id', testPayload.message_id);
      
      console.log('🧹 Test message cleaned up');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

verifySchema().then(() => {
  console.log('\n✅ Verification complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

