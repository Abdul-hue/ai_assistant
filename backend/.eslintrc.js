/**
 * ESLint Configuration for Backend
 * 
 * CODE QUALITY: Enforce consistent code style and catch common errors
 */

module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  rules: {
    // Error Prevention
    'no-console': 'off', // Allow console.log in backend
    'no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'no-undef': 'error',
    'no-unreachable': 'error',
    'consistent-return': 'error',
    
    // Best Practices
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-with': 'error',
    'no-new-func': 'error',
    'no-return-await': 'warn',
    
    // Code Style
    'indent': ['error', 2, { SwitchCase: 1 }],
    'quotes': ['warn', 'single', { avoidEscape: true }],
    'semi': ['error', 'always'],
    'comma-dangle': ['warn', 'never'],
    'no-trailing-spaces': 'warn',
    'eol-last': ['warn', 'always'],
    'object-curly-spacing': ['warn', 'always'],
    'array-bracket-spacing': ['warn', 'never'],
    
    // ES6+
    'prefer-const': 'warn',
    'no-var': 'error',
    'prefer-arrow-callback': 'warn',
    'arrow-spacing': 'warn',
    'prefer-template': 'warn',
    
    // Node.js specific
    'no-process-exit': 'warn',
    'handle-callback-err': 'warn',
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'auth_sessions/',
    'sessions/',
    '*.test.js',
    '*.spec.js',
  ],
};

