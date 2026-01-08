require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ✅ FIX: Trim the service role key to remove any whitespace
const trimmedServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

// Create Supabase client for database operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  trimmedServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Test connection on startup (non-blocking, won't fail if Supabase has issues)
async function testConnection() {
  try {
    // Try a simple auth admin call which doesn't require table permissions
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    
    if (error) {
      console.warn('⚠️  Database connection test failed:', error.message);
      console.warn('   This is non-critical - API endpoints may still work');
    } else {
      console.log('✅ Database connected successfully via Supabase');
    }
  } catch (error) {
    console.warn('⚠️  Database connection test failed:', error.message);
    console.warn('   This is non-critical - API endpoints may still work');
  }
}

// Test connection if environment variables are set (non-blocking, don't fail startup)
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  testConnection().catch(() => {
    // Silently fail - don't block startup
  });
} else {
  console.warn('⚠️  Supabase environment variables not set - database features will not work');
}

// ✅ FIXED: Create a pool-like interface that properly handles parameterized queries
const pool = {
  query: async (text, params = []) => {
    try {
      // ✅ FIXED: Handle INSERT queries with proper parameter mapping
      if (text.includes('INSERT')) {
        const tableMatch = text.match(/INSERT INTO\s+(\w+)\s*\((.*?)\)\s*VALUES/i);
        if (tableMatch) {
          const tableName = tableMatch[1];
          const columnsStr = tableMatch[2];
          
          // ✅ FIXED: Parse column names from the INSERT statement
          const columns = columnsStr.split(',').map(col => col.trim());
          
          // ✅ FIXED: Map parameters to column names
          const insertObject = {};
          columns.forEach((col, idx) => {
            if (idx < params.length) {
              insertObject[col] = params[idx];
            }
          });
          
          console.log(`[DATABASE] Inserting into ${tableName}:`, insertObject);
          
          const { data, error } = await supabase
            .from(tableName)
            .insert([insertObject])
            .select();
          
          if (error) {
            console.error(`[DATABASE] Insert error:`, error);
            throw error;
          }
          
          return { rows: data || [] };
        }
      } 
      // ✅ FIXED: Handle SELECT queries
      else if (text.includes('SELECT')) {
        const tableMatch = text.match(/FROM\s+(\w+)/i);
        if (tableMatch) {
          const tableName = tableMatch[1];
          
          // ✅ FIXED: Handle WHERE clauses with parameters
          const whereMatch = text.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/i);
          let query = supabase.from(tableName).select('*');
          
          if (whereMatch && params.length > 0) {
            const whereClause = whereMatch[1];
            // Simple WHERE handling for common patterns
            if (whereClause.includes('=')) {
              const conditions = whereClause.split(' AND ');
              conditions.forEach((cond, idx) => {
                const match = cond.match(/(\w+)\s*=\s*\$(\d+)/);
                if (match && params[idx] !== undefined) {
                  query = query.eq(match[1], params[idx]);
                }
              });
            }
          }
          
          const { data, error } = await query;
          
          if (error) throw error;
          return { rows: data || [] };
        }
      } 
      // ✅ FIXED: Handle UPDATE queries
      else if (text.includes('UPDATE')) {
        const tableMatch = text.match(/UPDATE\s+(\w+)\s+SET/i);
        const whereMatch = text.match(/WHERE\s+(.+)$/i);
        
        if (tableMatch && whereMatch) {
          const tableName = tableMatch[1];
          
          // ✅ FIXED: Parse SET clause
          const setMatch = text.match(/SET\s+(.+?)\s+WHERE/i);
          if (setMatch) {
            const setClauses = setMatch[1].split(',').map(s => s.trim());
            const updateObject = {};
            
            // ✅ FIXED: Map parameters to update fields
            setClauses.forEach((clause, idx) => {
              const match = clause.match(/(\w+)\s*=\s*\$(\d+)/);
              if (match && params[idx] !== undefined) {
                updateObject[match[1]] = params[idx];
              }
            });
            
            // ✅ FIXED: Handle WHERE clause for UPDATE
            const whereClause = whereMatch[1];
            const whereParamMatch = whereClause.match(/(\w+)\s*=\s*\$(\d+)/);
            
            let query = supabase.from(tableName).update(updateObject);
            
            if (whereParamMatch) {
              const whereParamIdx = parseInt(whereParamMatch[2]) - 1;
              query = query.eq(whereParamMatch[1], params[whereParamIdx]);
            }
            
            const { data, error } = await query.select();
            
            if (error) throw error;
            return { rows: data || [] };
          }
        }
      } 
      // ✅ FIXED: Handle DELETE queries
      else if (text.includes('DELETE')) {
        const tableMatch = text.match(/DELETE FROM\s+(\w+)/i);
        const whereMatch = text.match(/WHERE\s+(.+)$/i);
        
        if (tableMatch && whereMatch) {
          const tableName = tableMatch[1];
          const whereClause = whereMatch[1];
          const match = whereClause.match(/(\w+)\s*=\s*\$(\d+)/);
          
          if (match && params[match[2] - 1] !== undefined) {
            const { data, error } = await supabase
              .from(tableName)
              .delete()
              .eq(match[1], params[match[2] - 1])
              .select();
            
            if (error) throw error;
            return { rows: data || [] };
          }
        }
      }
      
      // Fallback: return empty result
      console.warn(`[DATABASE] Unhandled query: ${text}`);
      return { rows: [] };
    } catch (error) {
      console.error('[DATABASE] Query error:', error.message);
      throw error;
    }
  }
};

/**
 * DEPRECATED: The pool.query() interface is a custom SQL builder with limitations
 * For new code, use 'supabase' directly with the Supabase SDK:
 * 
 * Example migration:
 * OLD: await pool.query('SELECT * FROM agents WHERE user_id = $1', [userId])
 * NEW: const { data, error } = await supabase.from('agents').select('*').eq('user_id', userId)
 * 
 * Benefits of direct Supabase SDK:
 * - Type safety
 * - Better error handling
 * - No SQL parsing bugs
 * - Full feature support (joins, aggregations, etc.)
 */

module.exports = pool;
module.exports.supabase = supabase; // Export Supabase client for direct SDK usage
module.exports.pool = pool; // Explicit pool export for clarity
