# Docker Deployment Guide - ConnectBot AI

This guide covers Docker deployment for ConnectBot AI, including building, running, and managing the containerized application.

## 📋 Prerequisites

1. **Docker** (version 20.10+)
2. **Docker Compose** (version 2.0+)
3. **Environment File**: `backend/.env` with all required variables

## 🔧 Required Environment Variables

Create `backend/.env` file with the following variables:

```bash
# Core Configuration
NODE_ENV=production
PORT=3001

# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Webhooks
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/whatsapp-webhook
N8N_WEBHOOK_TIMEOUT=30000
WEBHOOK_RETRY_MAX_ATTEMPTS=3
WEBHOOK_RETRY_INITIAL_DELAY=2000
AGENT_DOCUMENT_WEBHOOK_URL=https://your-webhook.com/webhook/upload-documents
WHATSAPP_MESSAGE_WEBHOOK=https://your-webhook.com/webhook/whatsapp-messages

# Storage
AGENT_FILES_BUCKET=agent-files
AUDIO_BUCKET=agent-audio-messages
AUDIO_FALLBACK_BUCKET=agent-files
AUDIO_SIGNED_URL_TTL=604800

# CORS
ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com

# Optional
WEBHOOK_ENV=production
EXTRACTOR_MAX_FILE_BYTES=10000000
```

## 🚀 Quick Start

### 1. Build the Docker Image

```bash
docker-compose build
```

Or build without cache:

```bash
docker-compose build --no-cache
```

### 2. Start the Container

```bash
docker-compose up -d
```

The `-d` flag runs the container in detached mode (background).

### 3. View Logs

```bash
# View all logs
docker-compose logs -f

# View last 100 lines
docker-compose logs --tail=100 -f

# View logs for specific service
docker-compose logs -f connectbot-ai
```

### 4. Stop the Container

```bash
docker-compose down
```

To also remove volumes (⚠️ **WARNING**: This deletes auth_sessions):

```bash
docker-compose down -v
```

### 5. Restart the Container

```bash
docker-compose restart
```

## 📊 Health Check

The container includes a health check that verifies the backend is responding:

```bash
# Check container health status
docker-compose ps

# Manual health check
curl http://localhost:3001/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456,
  "environment": "production",
  "cors": "enabled"
}
```

## 🔍 Container Management

### View Running Containers

```bash
docker-compose ps
```

### Access Container Shell

```bash
docker-compose exec connectbot-ai sh
```

### View Container Resource Usage

```bash
docker stats connectbot-ai
```

### Restart Container

```bash
docker-compose restart connectbot-ai
```

## 🧪 Testing WhatsApp Message Sending

### 1. Verify Backend is Running

```bash
curl http://localhost:3001/api/health
```

### 2. Check WhatsApp Connection Status

First, get an agent ID from your database, then:

```bash
curl -X GET http://localhost:3001/api/agents/{agentId}/whatsapp/status \
  -H "Cookie: sb_access_token=YOUR_TOKEN"
```

### 3. Send a Test Message

```bash
curl -X POST http://localhost:3001/api/webhooks/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "your-agent-uuid",
    "to": "1234567890",
    "message": "Hello from Docker!"
  }'
```

**Expected Success Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "agentId": "your-agent-uuid",
    "to": "1234567890",
    "sentAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Response (if WhatsApp not connected):**
```json
{
  "success": false,
  "error": "WhatsApp not connected",
  "details": "Agent is not connected to WhatsApp. Status: disconnected",
  "status": "disconnected"
}
```

### 4. Test with Authentication

If testing authenticated endpoints:

```bash
# First, get access token (via OAuth or Supabase)
TOKEN="your-supabase-access-token"

# Then use it in requests
curl -X GET http://localhost:3001/api/agents \
  -H "Cookie: sb_access_token=${TOKEN}"
```

## 📁 Volume Management

### Auth Sessions Persistence

The `auth_sessions` directory is mounted as a named volume to persist WhatsApp sessions across container restarts.

**View volume:**
```bash
docker volume inspect connectbot-ai_auth_sessions_data
```

**Backup volume:**
```bash
docker run --rm \
  -v connectbot-ai_auth_sessions_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/auth_sessions_backup.tar.gz -C /data .
```

**Restore volume:**
```bash
docker run --rm \
  -v connectbot-ai_auth_sessions_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/auth_sessions_backup.tar.gz -C /data
```

## 🔄 Updating the Application

### 1. Pull Latest Code

```bash
git pull origin main
```

### 2. Rebuild Image

```bash
docker-compose build --no-cache
```

### 3. Restart Container

```bash
docker-compose down
docker-compose up -d
```

## 🐛 Troubleshooting

### Container Won't Start

1. **Check logs:**
   ```bash
   docker-compose logs connectbot-ai
   ```

2. **Verify environment variables:**
   ```bash
   docker-compose config
   ```

3. **Check if port is in use:**
   ```bash
   lsof -i :3001
   # or on Windows
   netstat -ano | findstr :3001
   ```

### WhatsApp Sessions Not Persisting

1. **Verify volume is mounted:**
   ```bash
   docker-compose exec connectbot-ai ls -la /app/backend/auth_sessions
   ```

2. **Check volume permissions:**
   ```bash
   docker-compose exec connectbot-ai ls -ld /app/backend/auth_sessions
   ```

3. **Verify volume exists:**
   ```bash
   docker volume ls | grep auth_sessions
   ```

### Health Check Failing

1. **Check if backend is responding:**
   ```bash
   curl http://localhost:3001/api/health
   ```

2. **Check container logs for errors:**
   ```bash
   docker-compose logs --tail=50 connectbot-ai
   ```

3. **Verify environment variables are set:**
   ```bash
   docker-compose exec connectbot-ai env | grep -E "SUPABASE|DATABASE"
   ```

### Frontend Not Loading

1. **Verify frontend was built:**
   ```bash
   docker-compose exec connectbot-ai ls -la /app/backend/public
   ```

2. **Check if index.html exists:**
   ```bash
   docker-compose exec connectbot-ai test -f /app/backend/public/index.html && echo "Exists" || echo "Missing"
   ```

3. **Verify static file serving:**
   ```bash
   curl http://localhost:3001/
   ```

## 📦 Image Optimization

The Dockerfile uses multi-stage builds to minimize image size:

- **Stage 1:** Builds frontend (Vite)
- **Stage 2:** Installs backend dependencies
- **Stage 3:** Final Alpine image with only production files

**Expected image size:** ~200-300 MB

**View image size:**
```bash
docker images connectbot-ai
```

## 🔐 Security Considerations

1. **Environment Variables:** Never commit `.env` files to git
2. **Volume Permissions:** Auth sessions volume has proper permissions
3. **Read-only Mounts:** `.env` file is mounted read-only
4. **Health Checks:** Regular health checks ensure service availability
5. **Rate Limiting:** Backend includes rate limiting for API protection

## 📝 Production Deployment Checklist

- [ ] All environment variables set in `backend/.env`
- [ ] Docker and Docker Compose installed
- [ ] Image built successfully
- [ ] Container starts without errors
- [ ] Health check passes
- [ ] WhatsApp sessions persist across restarts
- [ ] Can send messages via API
- [ ] Frontend loads correctly
- [ ] Logs are being monitored
- [ ] Backup strategy for auth_sessions volume

## 🚀 Production Recommendations

1. **Use Docker Swarm or Kubernetes** for orchestration
2. **Set up log aggregation** (e.g., ELK stack, Loki)
3. **Configure monitoring** (e.g., Prometheus, Grafana)
4. **Implement backup strategy** for auth_sessions volume
5. **Use secrets management** (e.g., Docker Secrets, HashiCorp Vault)
6. **Set up reverse proxy** (e.g., Nginx, Traefik) for SSL/TLS
7. **Configure resource limits** in docker-compose.yml:

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
    reservations:
      cpus: '1'
      memory: 1G
```

## 📞 Support

For issues or questions:
1. Check container logs: `docker-compose logs -f`
2. Verify environment variables
3. Review health check status
4. Check GitHub issues

---

**Last Updated:** 2024
**Docker Version:** 20.10+
**Docker Compose Version:** 2.0+

