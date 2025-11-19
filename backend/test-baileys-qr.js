// test-baileys-qr.js
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

async function testBaileysQR() {
  console.log('🚀 Starting Baileys QR Test...\n');

  // Use local file-based auth state
  const { state, saveCreds } = await useMultiFileAuthState('./test-session');

  // Create WhatsApp socket
  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false, // We'll handle QR ourselves
    logger: pino({ level: 'silent' }) // Disable verbose logs
  });

  // Listen for connection updates
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR CODE GENERATED
    if (qr) {
      console.log('📱 QR Code received from WhatsApp!\n');
      
      // Method 1: Display QR in terminal
      const qrTerminal = require('qrcode-terminal');
      qrTerminal.generate(qr, { small: true });
      
      // Method 2: Save QR as image file
      await QRCode.toFile('./qr-code.png', qr);
      console.log('\n✅ QR code saved to: qr-code.png');
      console.log('📸 Open this file to scan with WhatsApp\n');
      
      // Method 3: Generate base64 (what your API will return)
      const qrBase64 = await QRCode.toDataURL(qr);
      console.log('🔑 Base64 QR (first 100 chars):');
      console.log(qrBase64.substring(0, 100) + '...\n');
    }

    // AUTHENTICATED
    if (connection === 'open') {
      console.log('✅ WhatsApp Connected Successfully!');
      console.log('📱 Phone Number:', socket.user.id);
      
      // Test sending a message to yourself
      const yourNumber = socket.user.id; // Your WhatsApp number
      await socket.sendMessage(yourNumber, { 
        text: '🎉 Baileys QR Test Successful!' 
      });
      
      console.log('✅ Test message sent to yourself');
      
      // Close connection after test
      setTimeout(() => {
        console.log('\n👋 Closing connection...');
        socket.end();
        process.exit(0);
      }, 5000);
    }

    // DISCONNECTED
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connection closed:', lastDisconnect?.error);
      
      if (shouldReconnect) {
        console.log('🔄 Reconnecting...');
        testBaileysQR(); // Retry
      }
    }
  });

  // Save credentials when updated
  socket.ev.on('creds.update', saveCreds);

  // Listen for messages (test)
  socket.ev.on('messages.upsert', (m) => {
    console.log('📨 Message received:', JSON.stringify(m, null, 2));
  });
}

// Run the test
testBaileysQR().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});


