# ============================================================================
# Multi-stage Dockerfile for ConnectBot AI
# Stage 1: Build frontend (Vite)
# Stage 2: Install backend production dependencies
# Stage 3: Final image with Node 20 Alpine
# ============================================================================

# ============================================================================
# Stage 1: Build Frontend
# ============================================================================
FROM node:20-alpine AS frontend-builder

# Build arguments for frontend environment variables
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

# Set as environment variables for Vite build
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

WORKDIR /app

# Copy frontend package files
COPY frontend/package*.json ./
COPY frontend/vite.config.ts ./
COPY frontend/tsconfig*.json ./
COPY frontend/index.html ./
COPY frontend/postcss.config.js ./
COPY frontend/tailwind.config.ts ./
COPY frontend/components.json ./
COPY frontend/eslint.config.js ./

# Copy frontend source
COPY frontend/src ./src
COPY frontend/public ./public

# Install frontend dependencies
RUN npm ci

# Build frontend (Vite will use ENV variables)
RUN npm run build

# ============================================================================
# Stage 2: Install Backend Dependencies
# ============================================================================
FROM node:20-alpine AS backend-deps

WORKDIR /app/backend

# Copy backend package files
COPY backend/package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# ============================================================================
# Stage 3: Final Image
# ============================================================================
FROM node:20-alpine

# Install system dependencies required for Baileys QR code generation
# These are needed for canvas/image processing libraries
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Copy backend dependencies from stage 2
COPY --from=backend-deps /app/backend/node_modules ./backend/node_modules

# Copy backend source code
COPY backend/package*.json ./backend/
COPY backend/app.js ./backend/
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
COPY backend/scripts ./backend/scripts

# Copy built frontend from stage 1 to backend/public
COPY --from=frontend-builder /app/dist ./backend/public

# Create auth_sessions directory with proper permissions
# This directory will be mounted as a volume for persistence
RUN mkdir -p ./backend/auth_sessions && \
    chmod 755 ./backend/auth_sessions

# Set working directory to backend
WORKDIR /app/backend

# Expose port 3001
EXPOSE 3001

# Health check - verify backend is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "app.js"]

