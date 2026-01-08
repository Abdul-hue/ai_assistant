const { createOrUpdateUserProfile } = require('../config/supabase');

/**
 * Create or update user profile in Supabase
 * @param {Object} userData - User data from Supabase auth
 * @returns {Promise<Object>} - User profile
 */
async function createOrUpdateUser(userData) {
  try {
    console.log('🔍 Creating/updating user profile for:', userData.email);
    
    const userProfile = await createOrUpdateUserProfile(userData);
    
    console.log('✅ User profile processed:', userData.email);
    return userProfile;
  } catch (error) {
    console.error('❌ Error in createOrUpdateUser:', error.message);
    throw new Error('Database error: ' + error.message);
  }
}

module.exports = {
  createOrUpdateUser,
};
