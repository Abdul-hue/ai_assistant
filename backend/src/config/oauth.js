module.exports = {
  google: {
    clientID: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback',
  },
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production',
  jwtExpiry: '7d',
};