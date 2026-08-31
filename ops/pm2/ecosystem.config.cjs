/**
 * PM2 process file for the always-on Node services (Postgres stays in Docker).
 *
 *   pnpm add -g pm2         # or: npm i -g pm2
 *   pm2 start ops/pm2/ecosystem.config.cjs
 *   pm2 save && pm2 startup # survive reboots
 *
 * After `git pull`:
 *   pnpm install
 *   pm2 restart ops/pm2/ecosystem.config.cjs --update-env
 *
 * Each app reads the repo-root .env via its own loadEnv(); per-app overrides go
 * in the `env` block below.
 */
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const tsx = path.join(root, "node_modules/.bin/tsx");

function svc(name, appDir, extraEnv = {}) {
  return {
    name,
    cwd: path.join(root, "apps", appDir),
    script: tsx,
    args: "src/main.ts",
    interpreter: "none",
    env: { NODE_ENV: "production", ...extraEnv },
    autorestart: true,
    max_restarts: 20,
    restart_delay: 3000,
    kill_timeout: 10000, // give the ledger transaction / graceful stop time to finish
  };
}

module.exports = {
  apps: [
    svc("xrpl-indexer", "indexer"),
    svc("xrpl-api", "api"),
    svc("xrpl-backfiller", "backfiller"),
    svc("xrpl-worker", "worker", {
      WORKER_QUEUES: "nft.metadata,token.metadata,issuer.metadata,stats.rollup",
      WORKER_CONCURRENCY: "30",
    }),
  ],
};
