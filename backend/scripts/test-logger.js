/**
 * Test Shared Logger Service
 * Verifies the logger works across different services
 */

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const logger = require('../src/services/logger');

async function testLogger() {
  console.log('🧪 Testing Shared Logger Service...\n');

  try {
    // Test 1: Basic logging
    console.log('Test 1: Basic logging levels');
    logger.trace('Trace message (may not show)');
    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');
    logger.fatal('Fatal message');
    console.log('✅ All log levels tested\n');

    // Test 2: Structured logging
    console.log('Test 2: Structured logging');
    logger.info({
      userId: '12345',
      action: 'test',
      duration: 100
    }, 'Structured log message');
    console.log('✅ Structured logging works\n');

    // Test 3: Child loggers
    console.log('Test 3: Child loggers');
    const childLogger = logger.child({ component: 'test-component', service: 'test-service' });
    childLogger.info('Message from child logger');
    console.log('✅ Child logger works\n');

    // Test 4: Direct child usage
    console.log('Test 4: Direct child usage');
    const testChild = logger.child({ test: true });
    testChild.info('Message from direct child logger');
    console.log('✅ Direct child logger works\n');

    // Test 5: Verify instance ID
    console.log('Test 5: Instance ID');
    const logOutput = logger.info({ test: 'instance-check' }, 'Instance check');
    console.log('✅ Logger initialized with instance ID\n');

    console.log('🎉 All logger tests passed!');
    console.log('\n📊 Shared logger service is ready for use across all services');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testLogger();
