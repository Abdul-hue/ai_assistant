require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/database');

async function runMigration() {
  const migrationPath = path.join(__dirname, '../migrations/001_initial_schema.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');

  try {
    console.log('🔄 Starting database migration...');
    await pool.query(migration);
    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
