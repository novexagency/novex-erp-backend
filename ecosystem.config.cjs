/**
 * PM2 process file for production.
 * Usage: pm2 start ecosystem.config.cjs --env production
 */
module.exports = {
  apps: [
    {
      name: "novex-erp-api",
      script: "dist/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "512M",
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "storage/logs/pm2-error.log",
      out_file: "storage/logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
