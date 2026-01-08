module.exports = {
  apps: [{
    name: 'pa-agent-backend',
    script: './backend/app.js',
    node_args: '--max-old-space-size=4096 --expose-gc',
    max_memory_restart: '3500M',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    env: {
      NODE_ENV: 'development',
      PORT: 3001
    }
  }]
};

