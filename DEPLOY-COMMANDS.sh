#!/bin/bash
# Deployment Commands for pa.duhanashrah.ai
# Run these commands on the server

# ============================================================================
# Step 1: Connect to Server
# ============================================================================
# SSH command (run from your local machine):
# ssh -p 9856 root@69.87.218.122

# ============================================================================
# Step 2: Check Current Setup
# ============================================================================
docker ps -a
docker images
ls -la /root/

# ============================================================================
# Step 3: Stop and Remove Old Containers
# ============================================================================
docker ps -a --format "{{.Names}}" | grep -v "connectbot-ai" | xargs -r docker rm -f
docker-compose down -v 2>/dev/null || true

# ============================================================================
# Step 4: Install Docker and Docker Compose (if not installed)
# ============================================================================
# Check if Docker is installed
docker --version || {
    apt-get update
    apt-get install -y docker.io docker-compose
    systemctl start docker
    systemctl enable docker
}

# ============================================================================
# Step 5: Create Project Directory
# ============================================================================
cd /root
rm -rf connectbot-ai-main
mkdir -p connectbot-ai-main
cd connectbot-ai-main

# ============================================================================
# Step 6: Upload Project Files (from local machine)
# ============================================================================
# Run this from your LOCAL machine (Windows PowerShell):
# scp -P 9856 -r "C:\Users\Sam Cliff\Desktop\connectbot-ai-main\*" root@69.87.218.122:/root/connectbot-ai-main/

# ============================================================================
# Step 7: On Server - Navigate and Verify
# ============================================================================
cd /root/connectbot-ai-main
ls -la
ls -la backend/

# ============================================================================
# Step 8: Create .env file on server
# ============================================================================
cat > backend/.env << 'EOF'
DATABASE_URL=postgresql://postgres.M31llnzKLLLxQk2K:password@aws-0-us-west-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://dieozzsqexhptpfwrhxk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZW96enNxZXhocHRwZndyaHhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDkyMzkxMiwiZXhwIjoyMDc2NDk5OTEyfQ.nPyg3Vp83taCuhKja3blcN4QUWG6pg0xOPvOovtT-Ss
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZW96enNxZXhocHRwZndyaHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjM5MTIsImV4cCI6MjA3NjQ5OTkxMn0.u_bJIYqBIlAJU9_GeAApI3Rnf6TPhtIuN68yyJbFLgU
SUPABASE_JWT_SECRET=w9iByAFJ+kvOYgQ0VynxehGB8kQJHD1EABxylufllPigL2xgbbJ0DFR6IV6KSuLdpbtz7W8RSQQ2tIrFnc8ELQ==
PORT=3001
NODE_ENV=production
WEBHOOK_ENV=production
N8N_WEBHOOK_URL=https://auto.nsolbpo.com/webhook/whatsapp-webhook
N8N_WEBHOOK_TIMEOUT=30000
WEBHOOK_RETRY_MAX_ATTEMPTS=3
WEBHOOK_RETRY_INITIAL_DELAY=2000
AGENT_DOCUMENT_WEBHOOK_URL=https://auto.nsolbpo.com/webhook/upload-documents
AGENT_FILES_BUCKET=agent-files
EXTRACTOR_MAX_FILE_BYTES=10485760
WHATSAPP_MESSAGE_WEBHOOK_PROD=https://auto.nsolbpo.com/webhook/a18ff948-9380-4abe-a8d8-0912dae2d8ab
PINECONE_API_KEY=pcsk_4qPAh1_UQmo3TjEDvZdtBbu7ut4Qwcug7VP6oZFgysZYppFERPFbQGhSxm3eJ55SKUuWN8
PINECONE_INDEX_NAME=agentfiles
PINECONE_ENVIRONMENT=us-east-1
PINECONE_CHUNK_WORDS=500
PINECONE_CHUNK_OVERLAP=50
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_EMBEDDING_MODEL=text-embedding-ada-002
ALLOWED_ORIGINS=https://pa.duhanashrah.ai,http://localhost:3001,http://localhost:8080,http://localhost:5173
EOF

# ============================================================================
# Step 9: Set Build Arguments and Build
# ============================================================================
export SUPABASE_URL="https://dieozzsqexhptpfwrhxk.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZW96enNxZXhocHRwZndyaHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjM5MTIsImV4cCI6MjA3NjQ5OTkxMn0.u_bJIYqBIlAJU9_GeAApI3Rnf6TPhtIuN68yyJbFLgU"
docker-compose build --no-cache

# ============================================================================
# Step 10: Start Container
# ============================================================================
docker-compose up -d

# ============================================================================
# Step 11: Check Status
# ============================================================================
docker-compose ps
docker-compose logs --tail=30

# ============================================================================
# Step 12: Install and Configure Nginx (Reverse Proxy)
# ============================================================================
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

# Create Nginx configuration
cat > /etc/nginx/sites-available/pa.duhanashrah.ai << 'NGINX_EOF'
server {
    listen 80;
    server_name pa.duhanashrah.ai;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX_EOF

# Enable site
ln -sf /etc/nginx/sites-available/pa.duhanashrah.ai /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ============================================================================
# Step 13: Setup SSL with Let's Encrypt
# ============================================================================
certbot --nginx -d pa.duhanashrah.ai --non-interactive --agree-tos --email admin@duhanashrah.ai

# ============================================================================
# Step 14: Verify Deployment
# ============================================================================
curl http://localhost:3001/api/health
curl https://pa.duhanashrah.ai/api/health

