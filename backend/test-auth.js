#!/usr/bin/env node

/**
 * Authentication Integration Tests
 * Tests the complete Google OAuth flow without actual Google API calls
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  test: (msg) => console.log(`${colors.cyan}🧪 ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
};

// Test configuration
const TEST_USER = {
  email: 'test-user@example.com',
  name: 'Test User',
  google_id: 'test-google-id-12345',
};

let testsPassed = 0;
let testsFailed = 0;
let pool;

/**
 * Initialize database connection
 */
async function initDatabase() {
  log.info('Connecting to database...');
  
  if (!process.env.DATABASE_URL) {
    log.error('DATABASE_URL not set in environment');
    process.exit(1);
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query('SELECT NOW()');
    log.success('Database connected');
  } catch (error) {
    log.error('Database connection failed: ' + error.message);
    process.exit(1);
  }
}

/**
 * Clean up test data
 */
async function cleanupTestData() {
  try {
    await pool.query('DELETE FROM users WHERE email = $1', [TEST_USER.email]);
    log.info('Test data cleaned up');
  } catch (error) {
    log.warn('Cleanup warning: ' + error.message);
  }
}

/**
 * Test 1: Verify environment variables
 */
async function testEnvironmentVariables() {
  log.test('TEST 1: Environment Variables');
  
  const required = {
    'DATABASE_URL': process.env.DATABASE_URL,
    'GOOGLE_CLIENT_ID': process.env.GOOGLE_CLIENT_ID,
    'JWT_SECRET': process.env.JWT_SECRET,
  };

  let allSet = true;
  
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      log.error(`${key} is not set`);
      allSet = false;
      testsFailed++;
    } else {
      log.success(`${key} is set`);
    }
  }

  if (allSet) {
    testsPassed++;
    log.success('All environment variables are set');
  }
}

/**
 * Test 2: Database connection and schema
 */
async function testDatabaseSchema() {
  log.test('TEST 2: Database Schema');
  
  try {
    // Check if users table exists
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    if (result.rows.length === 0) {
      log.error('Users table does not exist');
      testsFailed++;
      return;
    }

    const columns = result.rows.map(r => r.column_name);
    const requiredColumns = ['id', 'email', 'name', 'avatar_url', 'google_id', 'created_at'];
    
    const missingColumns = requiredColumns.filter(col => !columns.includes(col));
    
    if (missingColumns.length > 0) {
      log.error('Missing columns: ' + missingColumns.join(', '));
      testsFailed++;
    } else {
      log.success('Users table has all required columns');
      testsPassed++;
    }
  } catch (error) {
    log.error('Schema check failed: ' + error.message);
    testsFailed++;
  }
}

/**
 * Test 3: Create user in database
 */
async function testCreateUser() {
  log.test('TEST 3: Create User');
  
  try {
    const result = await pool.query(
      `INSERT INTO users (email, name, avatar_url, google_id, oauth_provider, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, avatar_url, google_id`,
      [TEST_USER.email, TEST_USER.name, 'https://example.com/avatar.jpg', TEST_USER.google_id, 'google', true]
    );

    if (result.rows.length === 0) {
      log.error('User creation returned no rows');
      testsFailed++;
      return;
    }

    const user = result.rows[0];
    log.success(`User created: ${user.email} (ID: ${user.id})`);
    testsPassed++;
    
    return user;
  } catch (error) {
    log.error('User creation failed: ' + error.message);
    testsFailed++;
    return null;
  }
}

/**
 * Test 4: Find existing user
 */
async function testFindUser() {
  log.test('TEST 4: Find Existing User');
  
  try {
    const result = await pool.query(
      'SELECT id, email, name, avatar_url, google_id FROM users WHERE email = $1',
      [TEST_USER.email]
    );

    if (result.rows.length === 0) {
      log.error('User not found');
      testsFailed++;
      return null;
    }

    const user = result.rows[0];
    log.success(`User found: ${user.email}`);
    testsPassed++;
    
    return user;
  } catch (error) {
    log.error('User lookup failed: ' + error.message);
    testsFailed++;
    return null;
  }
}

/**
 * Test 5: Generate JWT
 */
async function testGenerateJWT() {
  log.test('TEST 5: JWT Generation');
  
  if (!process.env.JWT_SECRET) {
    log.error('JWT_SECRET not set');
    testsFailed++;
    return null;
  }

  try {
    const payload = {
      id: 'test-id-123',
      email: TEST_USER.email,
      name: TEST_USER.name,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    
    if (!token) {
      log.error('Token generation returned empty token');
      testsFailed++;
      return null;
    }

    log.success('JWT token generated');
    testsPassed++;
    
    return token;
  } catch (error) {
    log.error('JWT generation failed: ' + error.message);
    testsFailed++;
    return null;
  }
}

/**
 * Test 6: Verify JWT
 */
async function testVerifyJWT(token) {
  log.test('TEST 6: JWT Verification');
  
  if (!token) {
    log.error('No token provided to verify');
    testsFailed++;
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded.email || decoded.email !== TEST_USER.email) {
      log.error('Decoded token has incorrect email');
      testsFailed++;
      return;
    }

    log.success('JWT verified successfully');
    log.info(`Decoded email: ${decoded.email}`);
    testsPassed++;
  } catch (error) {
    log.error('JWT verification failed: ' + error.message);
    testsFailed++;
  }
}

/**
 * Test 7: Invalid JWT handling
 */
async function testInvalidJWT() {
  log.test('TEST 7: Invalid JWT Handling');
  
  const invalidToken = 'invalid.jwt.token';
  
  try {
    jwt.verify(invalidToken, process.env.JWT_SECRET);
    log.error('Invalid token was accepted (should have failed)');
    testsFailed++;
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      log.success('Invalid token correctly rejected');
      testsPassed++;
    } else {
      log.error('Unexpected error: ' + error.message);
      testsFailed++;
    }
  }
}

/**
 * Test 8: Duplicate user prevention
 */
async function testDuplicateUser() {
  log.test('TEST 8: Duplicate User Prevention');
  
  try {
    // Try to create user with same email
    await pool.query(
      `INSERT INTO users (email, name, avatar_url, google_id, oauth_provider, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [TEST_USER.email, 'Duplicate User', 'https://example.com/dup.jpg', 'different-google-id', 'google', true]
    );
    
    log.error('Duplicate user was created (should have been prevented)');
    testsFailed++;
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      log.success('Duplicate user correctly prevented');
      testsPassed++;
    } else {
      log.error('Unexpected error: ' + error.message);
      testsFailed++;
    }
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 Running Authentication Integration Tests');
  console.log('='.repeat(60) + '\n');

  try {
    // Initialize
    await initDatabase();
    await cleanupTestData();

    // Run tests
    await testEnvironmentVariables();
    await testDatabaseSchema();
    
    const createdUser = await testCreateUser();
    const foundUser = await testFindUser();
    
    const token = await testGenerateJWT();
    await testVerifyJWT(token);
    await testInvalidJWT();
    await testDuplicateUser();

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    log.success(`Tests passed: ${testsPassed}`);
    
    if (testsFailed > 0) {
      log.error(`Tests failed: ${testsFailed}`);
    }
    
    const total = testsPassed + testsFailed;
    const percentage = ((testsPassed / total) * 100).toFixed(1);
    
    console.log(`\n${colors.cyan}Success rate: ${percentage}%${colors.reset}`);
    
    if (testsFailed === 0) {
      log.success('All tests passed! ✨');
    } else {
      log.error('Some tests failed. Please review the errors above.');
    }

    // Cleanup
    await cleanupTestData();
    await pool.end();

    // Exit with appropriate code
    process.exit(testsFailed > 0 ? 1 : 0);
  } catch (error) {
    log.error('Test runner failed: ' + error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runTests();
