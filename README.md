# xrpl-indexer

A self-hosted XRP Ledger indexer, REST API, backfiller, and dashboard in one monorepo.

## Packages

| Path | Purpose |
| --- | --- |
| `packages/core` | zod config loader, pino logger, shared errors + domain types |
| `packages/codec` | XRPL codecs — address, currency, NFT tokenId, MPT issuance id, XLS-24/89 |
| `packages/db` | Drizzle schema + migrations + typed client + API-key helpers |
| `packages/xrpl-client` | rippled/Clio connection pool + ledger subscription/fetch |
| `packages/sources` | SSRF-hardened fetch, IPFS/Arweave resolver, metadata normalizer, providers |
| `packages/jobs` | pg-boss wrapper — queue names, typed payloads, helpers |
| `packages/enrich` | shared backfill handlers, `runRollup`, `runDiscovery` (used by worker + backfiller) |
| `apps/indexer` | ledger → Postgres ingestion (live sync + historical backfill) |
| `apps/api` | Fastify REST API (OpenAPI-compatible with the legacy `XRPL-API`) |
| `apps/backfiller` | pg-boss scheduler + work-discovery scans |
| `apps/worker` | pg-boss work handlers (`WORKER_QUEUES` selects what each instance does) |
| `apps/dashboard` | Next.js dashboard — talks to the API server-side only |

## Quick start

```bash
corepack enable                 # or: PATH="$HOME/.local/bin:$PATH"
pnpm install
cp .env.example .env             # then edit secrets

# 1. infrastructure — this only starts Postgres + pgweb
docker compose up -d             # Postgres on :5432, pgweb on :8081
pnpm db:migrate                  # apply drizzle/*.sql
ADMIN_BOOTSTRAP_USER=admin ADMIN_BOOTSTRAP_PASSWORD=<pw> pnpm bootstrap   # mint admin key + seed operator

# 2. the services — plain Node processes, NOT started by docker compose
pnpm --filter @xrpl-indexer/indexer    start   # ledger → Postgres
pnpm --filter @xrpl-indexer/api        start   # REST API on :4100
pnpm --filter @xrpl-indexer/backfiller start   # schedules + discovery (one instance)
WORKER_QUEUES=nft.metadata,token.metadata,issuer.metadata,stats.rollup \
  pnpm --filter @xrpl-indexer/worker   start
```

For anything real, run the services under a process manager rather than bare
shells — see **Running the services** below.

## Running the services

`docker compose` only manages Postgres + pgweb. `indexer`, `api`, `backfiller`
and `worker` are plain `tsx src/main.ts` processes — run them under a supervisor.

### PM2 (bundled config)

```bash
pnpm add -g pm2                              # or: npm i -g pm2
pm2 start ops/pm2/ecosystem.config.cjs
pm2 save && pm2 startup                      # survive reboots
pm2 status ; pm2 logs xrpl-indexer
```

**Redeploy after `git pull`:**

```bash
git pull
pnpm install                                # picks up dependency changes
pm2 restart ops/pm2/ecosystem.config.cjs --update-env
```

Restart just one: `pm2 restart xrpl-indexer`. The indexer is safe to bounce
anytime — it resumes from `indexer_checkpoint` and auto-catches-up any gap
(falling back to `XRPL_BACKFILL_ENDPOINTS` if the gap predates your sync node's
retained window). A one-off historical fill is a separate process:
`pnpm --filter @xrpl-indexer/indexer backfill`.

### systemd (alternative)

One unit per service, e.g. `/etc/systemd/system/xrpl-indexer.service`:

```ini
[Service]
WorkingDirectory=/opt/xrpl-indexer/apps/indexer
ExecStart=/opt/xrpl-indexer/node_modules/.bin/tsx src/main.ts
Restart=always
RestartSec=3
User=xrpl
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`git pull && pnpm install && sudo systemctl restart xrpl-indexer xrpl-api …`

### Docker (optional)

The repo ships no service image yet. If you want one, a root `Dockerfile` that
runs any app via an `APP=indexer|api|backfiller|worker` env plus compose services
is straightforward to add — ask if you want it.

## Hardware & sizing

`indexer`, `api`, `backfiller`, `worker` and Postgres are designed to co-locate on
one host (the dashboard goes on Vercel — see below). **Postgres is the sizing
driver**; the Node services are light and mostly network-bound.

| Tier | vCPU | RAM | Disk (NVMe SSD) | XRPL source | What you get |
| --- | --- | --- | --- | --- | --- |
| **Minimum** | 4 | 8 GB | 100 GB | public endpoints (`wss://xrplcluster.com`, …) | live-forward indexing from "now", API + dashboard, a few metadata workers. DB grows a few GB/month. |
| **Recommended** | 8 | 24–32 GB | 200 GB – 1 TB | public endpoints, or your own Clio | comfortable live sync + several M ledgers of history (XRP tracking off), 4–8 workers, tuned Postgres. |
| **Full history** | 16 | 64 GB+ | 2–4 TB, expandable | **your own Clio node or a paid full-history provider** — public endpoints will rate-limit/ban a genesis backfill | genesis backfill and/or `INDEXER_TRACK_XRP_BALANCES=true`. Use the TimescaleDB image + compression. |

### What actually consumes disk

The indexer stores, roughly in size order:

1. **`account_balance`** — append-only per-ledger balance-change log. IOU
   trustlines + MPT holdings + AMM/Vault reserves. This is the largest table.
   **Native XRP balances are *not* recorded per-account by default** —
   `INDEXER_TRACK_XRP_BALANCES=false` skips ~50 rows/ledger (~1 M/day, ~350 M/yr
   before indexes) of pure fee-payer churn. Turn it on only if you want an XRP
   rich list / per-account XRP history; pool pseudo-accounts are tracked either way.
2. **`token_exchange`** — one row per DEX fill (OfferCreate/Payment crossings).
   Needed for price series. Comparable to the old stack's `TokenExchange`.
3. **`nft`** — one row per NFT (`token_id` is a 64-char hex PK + 3 indexes).
4. **`nft_meta`** — enrichment cache: name/description/URIs/`attributes` jsonb.
5. **`token_supply` / `_holders` / `_trustlines` / `_marketcap`** — sparse
   "value changed at ledger N" points; small.
6. `account`, `ledger`, `nft_offer`, `nft_exchange`, `amm`, `vault`, `oracle` —
   all minor.

Postgres runs ~1.5–2.5× the on-disk size of the equivalent SQLite (per-row
overhead, no default page compression, wider hash keys stored as text). For a
window like "~7 M ledgers of history + full current NFT/token state + metadata"
(~70 GB on the old SQLite stack) expect **~120–180 GB** here with XRP tracking
off. A full genesis backfill *with* XRP tracking is where multi-TB comes from.
For very large deployments, use the **TimescaleDB** image and turn on columnar
compression for `account_balance` and `token_exchange` (5–20× on append-only
time-series), and range-partition `account_balance` by ledger so old partitions
compress or drop.

### XRPL endpoints — live vs. backfill

The indexer takes **two** endpoint lists so live sync and history can use
different nodes:

| Env var | Used by | Needs full history? |
| --- | --- | --- |
| `XRPL_SYNC_ENDPOINTS` | live `ledger` subscription + catch-up | no — a recent-window node (e.g. **your own Clio**) is ideal |
| `XRPL_BACKFILL_ENDPOINTS` | `--mode=backfill` range/gap fill | **yes** — your own full-history node, or a public one |
| `XRPL_ENDPOINTS` | fallback for whichever of the above is unset | — |

Typical setup: `XRPL_SYNC_ENDPOINTS` → your Clio, `XRPL_BACKFILL_ENDPOINTS` → a
public full-history cluster. The live syncer also automatically falls back to the
backfill endpoints if it needs a ledger the sync node has already pruned (e.g.
after a long outage), so a non-full-history Clio is safe for day-to-day sync.

**Per-process footprint** (steady state, once caught up):

| Process | vCPU | RAM | Notes |
| --- | --- | --- | --- |
| Postgres 16 | 2–8 | most of the box | give it the RAM and the fast disk |
| `apps/indexer` | ~1 | 256–512 MB | ~1 s/ledger measured — keeps up with 3–4 s closes with headroom |
| `apps/api` | 0.5–2 | 256–512 MB | scales with request volume; in-process cache + rate limiter |
| `apps/backfiller` | ~0.25 | 128–256 MB | singleton — one instance only (schedules + discovery scans) |
| `apps/worker` | ~0.25 each | ~256 MB each | run 1–8; **Bithomp / xrpl.to / xrplmeta rate limits are the real cap**, not CPU |

**Not required:** Redis (pg-boss is Postgres-backed), a message broker, object
storage (no media is ever downloaded), or your own rippled for live-forward use.

**OS / runtime:** Linux x86-64, Node 20+ (24 tested), pnpm 10/11, Docker + Docker
Compose (or a native Postgres 16). Outbound HTTPS/WSS to XRPL nodes, IPFS
gateways, and the metadata providers.

## Running workers on other machines

`apps/worker` is fully decoupled from the indexer and the API — it talks to
**Postgres only** (for the pg-boss queue and to write `*_meta` rows) and makes
outbound HTTPS to gateways/providers. So you can move enrichment load onto spare
VPSs.

**Topology**

- `apps/backfiller` — run on exactly **one** host (it owns the cron schedules and
  the discovery loop). Cheapest to keep it on the indexing box.
- `apps/worker` — run as many as you like, anywhere, each with its own
  `WORKER_QUEUES` / `WORKER_CONCURRENCY`.

**What a remote worker box needs**

1. Network path to Postgres. Best: a private mesh (WireGuard / Tailscale) between
   your boxes. Otherwise expose `5432` with TLS, a strong password, a
   `pg_hba.conf` allowlist, and a firewall — and set
   `DATABASE_URL=…?sslmode=require`.
2. Node 20+ and pnpm. No native deps, no build step.
3. The repo (or just a Docker image):

   ```bash
   git clone <repo> && cd xrpl-indexer
   pnpm install --filter @xrpl-indexer/worker...
   DATABASE_URL=postgres://xrpl:***@<indexer-host>:5432/xrpl_indexer?sslmode=require \
   WORKER_QUEUES=nft.metadata WORKER_CONCURRENCY=40 DB_POOL_MAX=6 \
   pnpm --filter @xrpl-indexer/worker start
   ```

**Splitting queues across boxes** (see `.env.example` for a worked example):

| Queue | Fan out to many boxes? | Why |
| --- | --- | --- |
| `nft.metadata` | ✅ yes | hits many different IPFS gateways; no shared limit |
| `token.metadata` / `issuer.metadata` | ⚠️ a couple | xrpl.to / xrplmeta are lenient but the rate limiter is **per process**, so N boxes = N× request rate |
| `nft.collection` | ❌ one box only | Bithomp plan limits are per-account; only that box gets `BITHOMP_API_KEY`, set `BITHOMP_REQUESTS_PER_MINUTE` to the plan cap |
| `stats.rollup` | ➖ doesn't matter | pg-boss delivers each scheduled fire to exactly one worker; just make sure *some* worker lists it |

**Connection budget:** each worker process opens `DB_POOL_MAX` (default 10)
Postgres connections plus a few for pg-boss. Keep `Σ(workers) × DB_POOL_MAX`
comfortably under Postgres `max_connections` (200 in the bundled compose), or put
PgBouncer in front.

## Deploying the dashboard on Vercel

The dashboard is a standard Next.js 15 app (`output: "standalone"`) and is
**fully decoupled from Postgres** — it only ever talks to `apps/api`. Operator
login goes through the API's `POST /admin/login` (double-gated: the
`admin`-scoped key *and* the `admin_user` password). So the one requirement is:

**`apps/api` must be reachable from Vercel** over the public internet, behind
TLS. It is already API-key-gated; put it on a subdomain (e.g.
`https://api.your-domain`) with a reverse proxy and set `XRPL_API_BASE_URL` to
that URL. No database exposure needed.

Server-only environment variables (never prefix with `NEXT_PUBLIC_`):

| Var | Purpose |
| --- | --- |
| `XRPL_API_BASE_URL` | public URL of `apps/api`, no trailing slash |
| `XRPL_API_KEY` | key with `nfts,tokens,amm,vaults,oracles,stats` scopes — public pages |
| `XRPL_API_ADMIN_KEY` | key with `admin` scope — `/admin/*`, `/backfill`, and operator login |
| `AUTH_SECRET` | 32+ byte random string for Auth.js session signing |

Mint the two API keys with `pnpm bootstrap` (first run) or from the running
dashboard's **Admin → API Keys** page. Seed the first operator with
`ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` (env for `pnpm bootstrap`, on
the indexing box — not on Vercel).

## Conventions

- **No media is ever downloaded.** Enrichment stores the canonical source link
  (`ipfs://<cid>/<path>`, `ar://…`, `data:`, `https://`) — consumers pick a gateway.
- **API keys never reach the browser.** The dashboard calls the API only from the
  server (RSC + Route Handlers); keys live in server-only env vars.
- Money is stored as Postgres `numeric` — XFL never enters storage.
- TypeScript is run directly via `tsx` / Next; packages export `src/*.ts`, no build step.
