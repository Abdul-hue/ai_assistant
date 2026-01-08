#!/usr/bin/env node

// Terminal QR Code Generator for WhatsApp Baileys Integration
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Configuration
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const AGENT_ID = 'test-agent-' + Date.now();

console.log('🚀 WhatsApp Baileys QR Code Generator');
console.log('=====================================');
console.log(`Agent ID: ${AGENT_ID}`);
console.log('');

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  console.log('📁 Created sessions directory');
}

async function generateQRCode() {
  try {
    console.log('🔄 Initializing WhatsApp connection...');
    
    // Create session directory for this agent
    const sessionPath = path.join(SESSIONS_DIR, AGENT_ID);
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    // Load auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    // Create WhatsApp socket
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: true, // Enable terminal QR printing
      logger: pino({ level: 'silent' }), // Disable verbose logs
      browser: ['WhatsApp AI Agent', 'Chrome', '1.0.0']
    });

    console.log('📱 WhatsApp socket created');
    console.log('⏳ Waiting for QR code...');
    console.log('');

    // Handle connection updates
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR CODE RECEIVED FROM WHATSAPP
      if (qr) {
        console.log('🎯 QR CODE GENERATED!');
        console.log('===================');
        console.log('📱 Open WhatsApp on your phone');
        console.log('⚙️  Go to Settings > Linked Devices');
        console.log('➕ Tap "Link a Device"');
        console.log('📷 Scan the QR code below:');
        console.log('');
        
        // Display QR code in terminal
        QRCode.generate(qr, { small: true }, (qr) => {
          console.log(qr);
        });
        
        console.log('');
        console.log('⏱️  QR code expires in 60 seconds');
        console.log('🔄 Generating new QR code if needed...');
        console.log('');
      }

      // AUTHENTICATED SUCCESSFULLY
      if (connection === 'open') {
        console.log('✅ WHATSAPP AUTHENTICATED SUCCESSFULLY!');
        console.log('=====================================');
        console.log(`📞 Phone Number: ${socket.user.id}`);
        console.log(`👤 Name: ${socket.user.name || 'Unknown'}`);
        console.log(`🆔 Agent ID: ${AGENT_ID}`);
        console.log('');
        console.log('🎉 Your WhatsApp is now connected!');
        console.log('📨 You can now send/receive messages');
        console.log('');
        console.log('Press Ctrl+C to disconnect and exit');
        
        // Listen for incoming messages
        socket.ev.on('messages.upsert', ({ messages }) => {
          for (const msg of messages) {
            if (!msg.message) continue;
            
            const messageContent = msg.message.conversation || 
                                  msg.message.extendedTextMessage?.text || 
                                  '';
            
            if (messageContent) {
              console.log(`📨 Message received: "${messageContent}"`);
              console.log(`👤 From: ${msg.key.remoteJid}`);
              console.log('');
            }
          }
        });
      }

      // CONNECTION CLOSED
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`❌ Connection closed. Reconnect: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          console.log('🔄 Reconnecting in 5 seconds...');
          setTimeout(() => generateQRCode(), 5000);
        } else {
          console.log('👋 Logged out. Exiting...');
          process.exit(0);
        }
      }
    });

    // Save credentials when updated
    socket.ev.on('creds.update', saveCreds);

    // Handle process termination
    process.on('SIGINT', async () => {
      console.log('\n👋 Disconnecting WhatsApp...');
      try {
        await socket.logout();
        console.log('✅ Disconnected successfully');
      } catch (error) {
        console.log('⚠️  Error during disconnect:', error.message);
      }
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error initializing WhatsApp:', error.message);
    console.log('💡 Make sure you have internet connection');
    process.exit(1);
  }
}

// Start the QR code generation
generateQRCode();
