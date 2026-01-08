# PA Agent - Architecture & Tech Stack

## Architecture Overview
**Full-stack AI agent platform** with React frontend (Vite + TypeScript) and Node.js/Express backend. Multi-stage with frontend build served by backend. Real-time communication via Socket.IO for WhatsApp QR codes and live updates.

## Tech Stack

### Frontend
- **React 18** + **TypeScript** + **Vite** for fast development and optimized builds
- **TanStack Query** for server state management and polling
- **Radix UI** + **Tailwind CSS** for accessible, modern UI components
- **Socket.IO Client** for real-time WebSocket communication

### Backend
- **Node.js 18.19.1** + **Express 4** REST API server
- **Supabase** (PostgreSQL) for database and authentication
- **Socket.IO** for bidirectional real-time communication
- **Pinecone** for vector storage and semantic search

## Core Libraries & Functionality

### WhatsApp Integration - Baileys
**@whiskeysockets/baileys v6.7.9**: WhatsApp Web protocol implementation
- QR code generation for device pairing
- Message sending/receiving (text only)
- Session management with automatic reconnection
- Webhook forwarding for AI processing(N8N WORKFLOW)

### Email Integration - IMAP/SMTP
**imap-simple + nodemailer**: Email synchronization and sending
- IMAP connection pooling with retry logic
- Real-time email sync via IDLE protocol
- SMTP email sending with OAuth2 support (Gmail/Outlook)
- Folder management and email parsing (mailparser)

### AI & Document Processing
- **Pinecone** vector database for RAG (Retrieval-Augmented Generation)
- **PDF-parse, ExcelJS, Mammoth** for document text extraction
- **N8N webhooks** for AI workflow orchestration
- Agent file processing with chunking and embedding

## Reliability Features

**Connection Resilience**: Automatic reconnection for WhatsApp sessions with exponential backoff. IMAP connection pooling with health checks and retry mechanisms.

**Error Handling**: Comprehensive error boundaries, duplicate message detection, and graceful degradation. Rate limiting on webhook endpoints.

**Data Consistency**: Database transactions, message deduplication by content+timestamp, and proper session state management.

**Monitoring**: Structured logging (Pino), connection status tracking, and webhook execution logs for debugging.

