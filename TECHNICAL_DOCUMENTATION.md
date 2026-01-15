# PA WhatsApp Assistant - Technical Documentation

**Version:** 1.0.0 | **Last Updated:** 2025 | **Status:** ✅ Production Ready

## 1. Project Overview

PA WhatsApp Assistant is a full-stack AI-powered customer service automation platform that enables businesses to create intelligent WhatsApp agents for automated customer interactions. The platform integrates WhatsApp messaging, email synchronization, and AI processing through N8N workflows, providing an omnichannel communication solution. Target users include businesses seeking to automate customer support, sales teams requiring 24/7 availability, and organizations needing unified communication management. Core technologies: React 18, TypeScript, Node.js 18.19.1, Express 4, Supabase (PostgreSQL), Baileys v6.7.9, Socket.IO, and Pinecone for vector storage.

## 2. Architecture

**Frontend Stack:** React 18 with TypeScript, Vite for build optimization, Radix UI components with Tailwind CSS for accessible design. State management via TanStack Query for server state and React Context for authentication. Real-time communication through Socket.IO client for live WhatsApp QR code updates. Performance optimizations include route-based code splitting (React.lazy), virtual scrolling (@tanstack/react-virtual), component memoization, and bundle analysis (rollup-plugin-visualizer).

**Backend Stack:** Node.js 18.19.1 with Express 4 REST API server. Database: Supabase (PostgreSQL) with Row Level Security (RLS) policies. Real-time: Socket.IO for bidirectional WebSocket communication. Vector storage: Pinecone for RAG (Retrieval-Augmented Generation) and semantic search. Structured logging with Pino for monitoring and debugging.

**System Architecture:** Client-server architecture with React SPA frontend served by Express backend. Real-time bidirectional communication via Socket.IO WebSockets. Database layer with Supabase PostgreSQL for persistent storage. External integrations: Baileys for WhatsApp protocol, IMAP/SMTP for email, N8N webhooks for AI processing, Pinecone for vector embeddings.

## 3. Key Features

**AI Agent Management:** Comprehensive agent creation with owner details, company integration, personality configuration, and custom instructions. Knowledge base support with file upload (PDF, DOCX, XLSX) and automatic text extraction for vector embedding. Contact management with CSV import/export and manual contact addition. WhatsApp connection via QR code scanning with automatic reconnection and session persistence.

**WhatsApp Messaging:** Real-time chat interface with ChatGPT-style UI featuring message bubbles, avatars, timestamps, and status indicators. Message handling includes text sending/receiving, deduplication by content+timestamp, and read receipt tracking. Session management with automatic reconnection using exponential backoff and clean disconnect/reconnect flow. Webhook integration forwards incoming messages to N8N workflows for AI processing.

**Email Integration:** Multi-provider support including Gmail OAuth, Outlook OAuth, and IMAP/SMTP for custom providers. Real-time synchronization via IDLE protocol for instant email notifications with connection pooling and retry logic. Unified inbox for viewing emails from multiple accounts with folder management and email parsing (mailparser). Security: AES-256-CBC encryption for stored passwords and OAuth token management.

**Knowledge Base & RAG:** Document processing with PDF-parse, ExcelJS, and Mammoth for text extraction. Vector embeddings stored in Pinecone for semantic search. Chunking strategy for large documents with automatic embedding generation. Context-aware responses using RAG retrieval from knowledge base.

## 4. Technical Implementation

**Database Schema:** Core tables: `agents` (agent configuration), `whatsapp_sessions` (session state), `message_log` (message history), `email_accounts` (email connections), `emails` (email messages), `contacts` (contact management). Relationships: Foreign keys with CASCADE DELETE, proper indexing on frequently queried columns. Data integrity: Unique constraints on `(email_account_id, provider_message_id)`, message deduplication by `(content, timestamp, agent_id, sender_type)`. Migrations: 17+ migration files for schema evolution with version control.

**API Endpoints:** RESTful API structure: `/api/agents` (CRUD operations), `/api/agents/:id/whatsapp/connect` (WhatsApp connection), `/api/agents/:id/messages` (message retrieval), `/api/messages/send` (send messages), `/api/email-accounts` (email management), `/api/webhooks/send-message` (outbound webhook). Authentication: Supabase JWT tokens in Authorization header, session cookies for persistence. Rate limiting: Express rate limiting on webhook endpoints to prevent abuse.

**Authentication & Security:** Supabase Auth with JWT tokens and session cookie management. Data encryption: AES-256-CBC for stored IMAP/SMTP passwords, secure OAuth token storage. Row Level Security (RLS): Database-level access control ensuring users can only access their own data. CORS configuration for frontend-backend communication. Environment variables for sensitive configuration (API keys, database URLs).

**Real-time Communication:** Socket.IO for bidirectional WebSocket communication. Events: `qr-code` (WhatsApp QR updates), `connection-status` (connection state changes), `new-message` (incoming messages). Client reconnection with exponential backoff. Server-side event emission for WhatsApp status updates and QR code generation.

**Error Handling & Logging:** Structured logging with Pino for JSON-formatted logs with log levels (info, warn, error). Error boundaries in React frontend for graceful error handling. Try-catch blocks with proper error propagation. Duplicate message detection to prevent processing same message twice. Graceful degradation: System continues operating even if non-critical components fail.

**Performance Optimizations:** Frontend: Route-based code splitting with React.lazy, component memoization (React.memo, useCallback, useMemo), virtual scrolling for long lists, bundle analysis and optimization. Backend: Connection pooling for IMAP/SMTP, efficient database queries with proper indexing, message deduplication to reduce processing overhead.

## 5. Setup & Installation

**Prerequisites:** Node.js 18.19.1 (required for backend), npm or yarn package manager, Supabase account and project, Pinecone account (for vector storage), N8N instance (for AI workflows), environment variables configured.

**Environment Variables:** Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PINECONE_API_KEY`, `N8N_WEBHOOK_URL`, `ENCRYPTION_KEY` (for password encryption), `JWT_SECRET`, `NODE_ENV`. Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (backend URL). See `frontend/env.example.txt` for complete list.

**Database Setup:** Run Supabase migrations from `supabase/migrations/` directory in order. Enable Row Level Security (RLS) on all tables. Create necessary indexes for performance. Verify RLS policies are correctly configured for user data isolation.

**Running the Application:** Backend: `cd backend && npm install && node app.js` (runs on port 3001). Frontend: `cd frontend && npm install && npm run dev` (runs on port 5173). Production build: `cd frontend && npm run build` (outputs to `dist/`). Use startup scripts: `.\start-backend.ps1` and `.\start-frontend.ps1` for Windows.

## 6. Development Status

**Current Completion:** ~95% production-ready. Core features fully implemented and tested. Frontend: Complete with modern UI/UX, accessibility compliance (WCAG 2.1 AA), performance optimizations. Backend: Stable API with comprehensive error handling, all integrations operational. Known limitations: Onboarding tour needs content configuration, media message support (images/documents) pending, some edge cases may require additional testing in production environment.

## 7. Future Roadmap

**Short-term (1-2 months):** Complete onboarding tour content and user flows, enhanced analytics dashboard with response time metrics, media message support (images, documents, audio), read receipt implementation for message status tracking.

**Medium-term (3-6 months):** Multi-language support for agent responses, advanced analytics and reporting, CRM/ERP integrations (Salesforce, HubSpot), team collaboration features (shared agents, role-based permissions).

**Long-term (6+ months):** Voice message support, video call integration, advanced AI model fine-tuning capabilities, white-label solution for resellers and enterprise clients.

## 8. Security & Compliance

**Authentication Methods:** Supabase Auth with email/password and OAuth providers (Google, Microsoft). JWT tokens for API authentication, session cookies for web persistence. Token refresh mechanism for long-lived sessions.

**Data Encryption:** AES-256-CBC encryption for stored IMAP/SMTP passwords before database storage. OAuth tokens stored securely (already encrypted by OAuth providers). Environment variables for sensitive keys (never committed to repository).

**Row-Level Security:** Database-level RLS policies ensure users can only access their own agents, messages, and email accounts. Foreign key constraints with CASCADE DELETE for data integrity. Audit logging for sensitive operations (optional, can be enabled).

**Accessibility Compliance:** WCAG 2.1 AA compliance with ARIA labels on all interactive elements, keyboard navigation support, screen reader compatibility, focus management for modals and dialogs. Semantic HTML structure throughout the application.

---

**Documentation Version:** 1.0.0 | **Maintained By:** Development Team | **For Support:** See project README.md
