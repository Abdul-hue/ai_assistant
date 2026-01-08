const { initializeWhatsApp, disconnectWhatsApp, getSessionStatus } = require('../src/services/baileysService');
const { supabaseAdmin } = require('../src/config/supabase');

// Test configuration
const TEST_AGENT_ID = '36d8d25a-f9f7-42cd-80f5-baff946dad89'; // Replace with your agent ID

console.log('\n🧪 ==================== WHATSAPP CONNECTION TEST SUITE ====================\n');

async function runTests() {
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Database Connection
  console.log('📋 Test 1: Database Connection');
  try {
    const { data, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('agent_id')
      .limit(1);
    
    if (error) throw error;
    
    console.log('✅ PASS: Database connected successfully\n');
    testsPassed++;
  } catch (error) {
    console.error('❌ FAIL: Database connection failed:', error.message);
    testsFailed++;
  }

  // Test 2: Clean Start
  console.log('📋 Test 2: Clean Database State');
  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .update({
        session_state: null,
        qr_code: null,
        qr_generated_at: null,
        is_active: false,
        phone_number: null
      })
      .eq('agent_id', TEST_AGENT_ID);
    
    if (error) throw error;
    
    console.log('✅ PASS: Database cleaned successfully\n');
    testsPassed++;
  } catch (error) {
    console.error('❌ FAIL: Database cleanup failed:', error.message);
    testsFailed++;
  }

  // Test 3: Initialize WhatsApp
  console.log('📋 Test 3: Initialize WhatsApp Connection');
  try {
    const session = await initializeWhatsApp(TEST_AGENT_ID);
    
    if (!session) {
      throw new Error('Session not created');
    }
    
    console.log('✅ PASS: WhatsApp initialized successfully');
    console.log(`   Socket exists: ${!!session.socket}`);
    console.log(`   Session stored: true\n`);
    testsPassed++;
  } catch (error) {
    console.error('❌ FAIL: WhatsApp initialization failed:', error.message);
    testsFailed++;
  }

  // Test 4: QR Code Generation
  console.log('📋 Test 4: QR Code Generation');
  console.log('⏳ Waiting 5 seconds for QR code...\n');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    const { data: session, error } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('qr_code, qr_generated_at')
      .eq('agent_id', TEST_AGENT_ID)
      .single();
    
    if (error) throw error;
    
    if (!session.qr_code) {
      throw new Error('QR code not generated');
    }
    
    console.log('✅ PASS: QR code generated successfully');
    console.log(`   QR length: ${session.qr_code.length} characters`);
    console.log(`   Generated at: ${session.qr_generated_at}`);
    console.log(`   Time since generation: ${Math.round((Date.now() - new Date(session.qr_generated_at).getTime()) / 1000)}s\n`);
    testsPassed++;
  } catch (error) {
    console.error('❌ FAIL: QR code generation failed:', error.message);
    testsFailed++;
  }

  // Test 5: Session Status Check
  console.log('📋 Test 5: Session Status');
  try {
    const status = getSessionStatus(TEST_AGENT_ID);
    
    if (!status.exists) {
      throw new Error('Session does not exist in memory');
    }
    
    console.log('✅ PASS: Session status retrieved');
    console.log(`   Exists: ${status.exists}`);
    console.log(`   Connected: ${status.isConnected}`);
    console.log(`   Has QR: ${!!status.qrCode}\n`);
    testsPassed++;
  } catch (error) {
    console.error('❌ FAIL: Session status check failed:', error.message);
    testsFailed++;
  }

  // Test 6: Manual Scan Test
  console.log('📋 Test 6: Manual QR Scan Test');
  console.log('⏳ PLEASE SCAN THE QR CODE NOW');
  console.log('   - Open WhatsApp on your phone');
  console.log('   - Go to: Settings → Linked Devices → Link a Device');
  console.log('   - Scan the QR code displayed in the frontend');
  console.log('   - Waiting 60 seconds for scan...\n');
  
  let scanSuccess = false;
  const scanStartTime = Date.now();
  
  // Poll for connection for 60 seconds
  while (Date.now() - scanStartTime < 60000) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const { data: session } = await supabaseAdmin
      .from('whatsapp_sessions')
      .select('is_active, phone_number')
      .eq('agent_id', TEST_AGENT_ID)
      .single();
    
    if (session?.is_active) {
      scanSuccess = true;
      console.log('✅ PASS: QR scan successful!');
      console.log(`   Phone number: ${session.phone_number}`);
      console.log(`   Time taken: ${Math.round((Date.now() - scanStartTime) / 1000)}s\n`);
      testsPassed++;
      break;
    }
    
    process.stdout.write('.');
  }
  
  if (!scanSuccess) {
    console.error('\n❌ FAIL: QR scan timeout (60 seconds)');
    console.error('   Possible issues:');
    console.error('   - QR code not scanned');
    console.error('   - creds.update event not firing');
    console.error('   - Credentials not being saved');
    console.error('   - Connection handshake failing\n');
    testsFailed++;
  }

  // Test 7: Connection Persistence
  if (scanSuccess) {
    console.log('📋 Test 7: Connection Persistence Check');
    try {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const { data: session } = await supabaseAdmin
        .from('whatsapp_sessions')
        .select('is_active, session_state')
        .eq('agent_id', TEST_AGENT_ID)
        .single();
      
      if (!session.is_active) {
        throw new Error('Connection dropped after initial success');
      }
      
      if (!session.session_state?.creds) {
        throw new Error('Credentials not saved in database');
      }
      
      console.log('✅ PASS: Connection persisted');
      console.log(`   Still active: ${session.is_active}`);
      console.log(`   Credentials saved: ${!!session.session_state.creds}`);
      console.log(`   Keys saved: ${!!session.session_state.keys}\n`);
      testsPassed++;
    } catch (error) {
      console.error('❌ FAIL: Connection persistence failed:', error.message);
      testsFailed++;
    }
  }

  // Test Summary
  console.log('\n🎯 ==================== TEST SUMMARY ====================');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📊 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
  
  if (testsFailed === 0) {
    console.log('🎉 ALL TESTS PASSED! WhatsApp connection is working correctly.');
  } else {
    console.log('⚠️ SOME TESTS FAILED. Check logs above for details.');
  }
  
  console.log('==================== TEST COMPLETE ====================\n');
  
  process.exit(testsFailed === 0 ? 0 : 1);
}

// Run tests
runTests().catch((error) => {
  console.error('💥 FATAL ERROR:', error);
  process.exit(1);
});

