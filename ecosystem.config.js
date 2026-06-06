module.exports = {
  apps: [
    {
      name: 'nightpick',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || 3737,
        INVITE_ONLY: process.env.INVITE_ONLY || 'false',
        ADMIN_SECRET: process.env.ADMIN_SECRET,
      },
    },
  ],
};