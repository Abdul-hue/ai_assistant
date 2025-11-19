#!/usr/bin/env node
/**
 * Startup script to run both frontend and backend services
 * This script starts the backend Express server and the frontend static server
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(service, message, color = colors.reset) {
  const timestamp = new Date().toISOString();
  console.log(`${color}[${timestamp}] [${service}]${colors.reset} ${message}`);
}

// Track processes
const processes = [];

// Cleanup function
function cleanup() {
  log('MAIN', 'Shutting down services...', colors.yellow);
  processes.forEach((proc) => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  setTimeout(() => {
    processes.forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 5000);
}

// Handle shutdown signals
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGUSR2', cleanup); // Nodemon restart

// Start Backend
log('MAIN', 'Starting backend server...', colors.blue);
const backend = spawn('node', ['backend/app.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
});

backend.on('error', (error) => {
  log('BACKEND', `Failed to start: ${error.message}`, colors.red);
  process.exit(1);
});

backend.on('exit', (code, signal) => {
  if (code !== 0 && code !== null) {
    log('BACKEND', `Exited with code ${code}`, colors.red);
    cleanup();
  } else if (signal) {
    log('BACKEND', `Exited with signal ${signal}`, colors.yellow);
  }
});

processes.push(backend);

// Wait a bit for backend to start, then start frontend
setTimeout(() => {
  log('MAIN', 'Starting frontend server...', colors.blue);
  const frontend = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, PORT: process.env.FRONTEND_PORT || '8080' },
  });

  frontend.on('error', (error) => {
    log('FRONTEND', `Failed to start: ${error.message}`, colors.red);
    // Don't exit, backend might still be running
  });

  frontend.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      log('FRONTEND', `Exited with code ${code}`, colors.red);
    } else if (signal) {
      log('FRONTEND', `Exited with signal ${signal}`, colors.yellow);
    }
  });

  processes.push(frontend);
}, 2000); // Wait 2 seconds for backend to initialize

// Log startup complete
setTimeout(() => {
  log('MAIN', 'All services started successfully!', colors.green);
  log('MAIN', 'Frontend: http://localhost:8080', colors.green);
  log('MAIN', 'Backend API: http://localhost:3001', colors.green);
}, 3000);

