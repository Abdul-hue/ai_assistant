# Docker Quick Start Guide

## 🚀 One-Command Setup

```bash
# 1. Ensure backend/.env exists with all required variables
# 2. Build and start
docker-compose up -d --build
```

## ✅ Verify Installation

```bash
# Check health
curl http://localhost:3001/api/health

# View logs
docker-compose logs -f

# Check container status
docker-compose ps
```

## 📤 Test WhatsApp Message Sending

```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "your-agent-uuid",
    "to": "1234567890",
    "message": "Test from Docker!"
  }'
```

## 🛑 Stop Container

```bash
docker-compose down
```

## 📁 Important Files

- `Dockerfile` - Multi-stage build configuration
- `docker-compose.yml` - Service definition with volumes
- `.dockerignore` - Build context exclusions
- `backend/.env` - **REQUIRED** - Environment variables

## 🔑 Critical Volumes

- `auth_sessions_data` - Persists WhatsApp sessions (DO NOT DELETE)
- `backend/.env` - Mounted read-only for environment variables

---

For detailed instructions, see [README-DOCKER.md](./README-DOCKER.md)

