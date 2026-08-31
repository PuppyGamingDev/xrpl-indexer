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
docker compose up -d             # Postgres on :5432, pgweb on :8081
pnpm db:migrate                  # apply drizzle/*.sql
pnpm bootstrap                   # mint the admin API key + first dashboard operator
```

## Hardware & sizing

`indexer`, `api`, `backfiller`, `worker` and Postgres are designed to co-locate on
one host (the dashboard goes on Vercel — see below). **Postgres is the sizing
driver**; the Node services are light and mostly network-bound.

| Tier | vCPU | RAM | Disk (NVMe SSD) | XRPL source | What you get |
| --- | --- | --- | --- | --- | --- |
| **Minimum** | 4 | 8 GB | 100 GB | public endpoints (`wss://xrplcluster.com`, …) | live-forward indexing from "now", API + dashboard, a few metadata workers. DB grows a few GB/month. |
| **Recommended** | 8 | 32 GB | 500 GB – 1 TB | public endpoints, or your own Clio | comfortable live sync + a few weeks/months of history, 4–8 workers, Postgres tuned (`shared_buffers` ≈ 8 GB, `effective_cache_size` ≈ 24 GB). |
| **Full history** | 16 | 64 GB+ | 2–4 TB, expandable | **your own Clio node or a paid full-history provider** — public endpoints will rate-limit/ban a genesis backfill | complete `account_balance` + metric history. Consider the TimescaleDB image for `account_balance` and the metric-point tables. |

Disk is the number to watch: `account_balance` is an append-only per-ledger
change log and is by far the largest table. Live-forward stays small; historical
backfill is what turns this into a multi-hundred-GB / multi-TB database.

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

The dashboard is a standard Next.js 15 app (`output: "standalone"`), safe to host
on Vercel. Two connectivity requirements:

1. **`apps/api` must be reachable from Vercel** over the public internet, behind
   TLS. It is already API-key-gated; put it on a subdomain (e.g.
   `https://api.your-domain`) with a reverse proxy. Set `XRPL_API_BASE_URL` to
   that URL.
2. **Operator login needs Postgres.** `src/lib/operators.ts` verifies the
   `admin_user` row directly, so a Vercel deployment needs `DATABASE_URL` to
   point at a Postgres instance reachable from Vercel's functions (SSL, firewall
   allowlist, or a connection proxy). If you don't want to expose Postgres,
   restrict `/admin/**` to the self-hosted box instead and deploy only the
   public pages to Vercel.

Server-only environment variables (never prefix with `NEXT_PUBLIC_`):

| Var | Purpose |
| --- | --- |
| `XRPL_API_BASE_URL` | public URL of `apps/api` |
| `XRPL_API_KEY` | key with `nfts,tokens,amm,vaults,oracles,stats` scopes — public pages |
| `XRPL_API_ADMIN_KEY` | key with `admin` scope — `/admin/*` and `/backfill` job stats |
| `AUTH_SECRET` | 32+ byte random string for Auth.js session signing |
| `DATABASE_URL` | Postgres, for operator (`admin_user`) verification |

Mint the two API keys with `pnpm bootstrap` (first run) or from the running
dashboard's **Admin → API Keys** page.

## Conventions

- **No media is ever downloaded.** Enrichment stores the canonical source link
  (`ipfs://<cid>/<path>`, `ar://…`, `data:`, `https://`) — consumers pick a gateway.
- **API keys never reach the browser.** The dashboard calls the API only from the
  server (RSC + Route Handlers); keys live in server-only env vars.
- Money is stored as Postgres `numeric` — XFL never enters storage.
- TypeScript is run directly via `tsx` / Next; packages export `src/*.ts`, no build step.
