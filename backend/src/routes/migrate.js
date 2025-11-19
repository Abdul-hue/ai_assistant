const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../database');

const router = express.Router();

/**
 * POST /api/migrate/run
 * Run database migrations (one-time setup)
 * WARNING: This should be removed after initial setup
 */
router.post('/run', async (req, res) => {
  try {
    console.log('🔄 Starting database migration...');

    const migrationPath = path.join(__dirname, '../../migrations/001_initial_schema.sql');
    
    if (!fs.existsSync(migrationPath)) {
      return res.status(500).json({
        error: 'Migration file not found',
        path: migrationPath
      });
    }

    const migration = fs.readFileSync(migrationPath, 'utf8');

    // Run migration
    await pool.query(migration);

    console.log('✅ Migration completed successfully');

    res.json({
      success: true,
      message: 'Database migration completed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);

    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/migrate/status
 * Check if migrations have been run
 */
router.get('/status', async (req, res) => {
  try {
    // Check if users table exists
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);

    const usersTableExists = result.rows[0].exists;

    res.json({
      success: true,
      tablesExist: usersTableExists,
      message: usersTableExists 
        ? 'Migrations already run' 
        : 'Migrations need to be run',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Status check failed:', error.message);

    res.status(500).json({
      success: false,
      error: 'Status check failed',
      message: error.message
    });
  }
});

module.exports = router;
