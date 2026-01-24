require('dotenv').config();

/**
 * Environment variable validation and configuration
 */
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

const optionalEnvVars = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
  STORAGE_BUCKET_NAME: process.env.STORAGE_BUCKET_NAME || 'whatsapp-media-files',
  SIGNED_URL_EXPIRY: parseInt(process.env.SIGNED_URL_EXPIRY) || 604800, // 7 days
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 52428800, // 50MB
  QUEUE_CONCURRENCY: parseInt(process.env.QUEUE_CONCURRENCY) || 5,
  RETRY_ATTEMPTS: parseInt(process.env.RETRY_ATTEMPTS) || 3
};

// Validate required environment variables
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  throw new Error('Missing required environment variables');
}

module.exports = {
  ...optionalEnvVars,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
};
