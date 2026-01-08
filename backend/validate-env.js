#!/usr/bin/env node

/**
 * Environment Validation Script
 * Tests all Supabase connections and environment variables
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('🔍 Validating Supabase Environment Configuration...\n');

// Check environment variables
const requiredEnvVars = {
  'SUPABASE_URL': process.env.SUPABASE_URL,
  'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
  'SUPABASE_ANON_KEY': process.env.SUPABASE_ANON_KEY,
  'SUPABASE_JWT_SECRET': process.env.SUPABASE_JWT_SECRET,
  'DATABASE_URL': process.env.DATABASE_URL,
};

console.log('📋 Environment Variables Status:');
console.log('================================');

let allPresent = true;
Object.entries(requiredEnvVars).forEach(([key, value]) => {
  const status = value ? '✅ Set' : '❌ Missing';
  const maskedValue = value ? `${value.substring(0, 10)}...` : 'Not set';
  console.log(`${key}: ${status} (${maskedValue})`);
  if (!value) allPresent = false;
});

console.log('\n🔗 Testing Supabase Connections:');
console.log('=================================');

async function testConnections() {
  try {
    // Test 1: Service Role Client
    console.log('\n1. Testing Service Role Client...');
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );

      // Test database connection
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('count')
        .limit(1);

      if (error) {
        console.log('   ❌ Service Role Client Error:', error.message);
      } else {
        console.log('   ✅ Service Role Client: Connected successfully');
      }
    } else {
      console.log('   ⚠️  Service Role Client: Missing credentials');
    }

    // Test 2: Anon Client
    console.log('\n2. Testing Anon Client...');
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      const supabaseAnon = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );

      // Test auth endpoint
      const { data: { session }, error } = await supabaseAnon.auth.getSession();
      
      if (error) {
        console.log('   ❌ Anon Client Error:', error.message);
      } else {
        console.log('   ✅ Anon Client: Connected successfully');
      }
    } else {
      console.log('   ⚠️  Anon Client: Missing credentials');
    }

    // Test 3: JWT Secret Validation
    console.log('\n3. Testing JWT Secret...');
    if (process.env.SUPABASE_JWT_SECRET) {
      try {
        const jwt = require('jsonwebtoken');
        const testPayload = { test: 'validation' };
        const testToken = jwt.sign(testPayload, process.env.SUPABASE_JWT_SECRET, { expiresIn: '1m' });
        const decoded = jwt.verify(testToken, process.env.SUPABASE_JWT_SECRET);
        
        if (decoded.test === 'validation') {
          console.log('   ✅ JWT Secret: Valid and working');
        } else {
          console.log('   ❌ JWT Secret: Invalid');
        }
      } catch (error) {
        console.log('   ❌ JWT Secret Error:', error.message);
      }
    } else {
      console.log('   ⚠️  JWT Secret: Not set');
    }

    // Test 4: Database URL
    console.log('\n4. Testing Database URL...');
    if (process.env.DATABASE_URL) {
      try {
        const { Pool } = require('pg');
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
        
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time');
        console.log('   ✅ Database: Connected successfully');
        console.log(`   📅 Server Time: ${result.rows[0].current_time}`);
        client.release();
        await pool.end();
      } catch (error) {
        console.log('   ❌ Database Error:', error.message);
      }
    } else {
      console.log('   ⚠️  Database: URL not set');
    }

  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
  }
}

// Run the tests
testConnections().then(() => {
  console.log('\n📊 Summary:');
  console.log('===========');
  
  if (allPresent) {
    console.log('✅ All required environment variables are set');
    console.log('🚀 Your Supabase configuration is ready!');
  } else {
    console.log('❌ Some environment variables are missing');
    console.log('📝 Please check the setup instructions');
  }
  
  process.exit(allPresent ? 0 : 1);
});
