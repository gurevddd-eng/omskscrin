/**
 * PM2 config for Омскэкран API + admin (Debian).
 * Usage on server:
 *   cd /root/omskscrin && pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: "omskscrin",
      cwd: "./apps/server",
      script: "dist/index.js",
      node_args: "--import ./scripts/set-prod-env.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
