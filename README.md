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
pnpm --filter @xrpl-indexer/backfiller start   # schedules + discovery + token.catalog + rollup (one instance)
WORKER_QUEUES=nft.metadata,nft.collection,token.metadata \
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
pnpm --filter @xrpl-indexer/db migrate      # apply any new drizzle/*.sql
pm2 restart ops/pm2/ecosystem.config.cjs --update-env
```

Restart just one: `pm2 restart xrpl-indexer`. The indexer is safe to bounce
anytime — it resumes from `indexer_checkpoint` and auto-catches-up any gap
(falling back to `XRPL_BACKFILL_ENDPOINTS` if the gap predates your sync node's
retained window).

The bundled PM2 config also defines **`xrpl-ledger-backfill`** — a dedicated,
resumable process that walks history *descending* from the first indexed ledger
down to `INDEXER_BACKFILL_FLOOR` (see **Historical ledger backfill** below). It
no-ops unless that floor is `> 0`.

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
| `XRPL_BACKFILL_ENDPOINTS` | `--mode=backfill` descending history fill + live-sync pruned-gap fallback | **yes** — your own full-history node, or a public one |
| `XRPL_ENDPOINTS` | fallback for whichever of the above is unset | — |

Typical setup: `XRPL_SYNC_ENDPOINTS` → your Clio, `XRPL_BACKFILL_ENDPOINTS` → a
public full-history cluster. The live syncer also automatically falls back to the
backfill endpoints if it needs a ledger the sync node has already pruned (e.g.
after a long outage), so a non-full-history Clio is safe for day-to-day sync.

### Initial state snapshot

Live sync only captures `AffectedNodes` deltas from the moment it starts, so a
dormant trustline / NFT / pool that's never touched again would stay invisible.
On first start (or on the next restart of an already-running indexer),
`INDEXER_SNAPSHOT_ON_START=true` runs a one-time `ledger_data` walk of the full
ledger state and feeds every object through the same handlers, then hands off to
live sync which catches up from the checkpoint to current.

- **Self-detecting.** Tracked in the `snapshot_state` table — if it has never
  reached `done`, the snapshot runs. Existing databases just need `pnpm db:migrate`
  (adds `snapshot_state`) and a restart.
- **Snapshots at the checkpoint ledger** when one exists, so it fills in the
  dormant objects *as of where delta-sync already is* — `INSERT … DO NOTHING`
  means it never regresses state you already have. Fresh DB → snapshots at
  current and seeds the checkpoint.
- **Resumable.** Kill it (PM2 restart, crash) and it continues from the persisted
  pass + marker.
- **Speed depends on admin access, not just Clio.** `ledger_data` for a
  *non-admin* connection is capped at **256 objects/page** (rippled and Clio
  both) — a full snapshot is then several hours. An **admin** connection lifts
  that to 2048/page (~10× faster, ~30–90 min):
  - run `--mode=snapshot` on the node's own box → `ws://127.0.0.1:<clio-port>`
    is admin, or
  - add the indexer box's IP to Clio's `dos_guard.whitelist` (whitelisted =
    admin), or
  - point `XRPL_SNAPSHOT_ENDPOINTS` at **rippled's admin WS port**
    (`ws://<node-lan-ip>:6006`) — rippled keeps recent ledgers, which covers the
    snapshot ledger.
- `pnpm --filter @xrpl-indexer/indexer start -- --mode=snapshot` runs just the
  snapshot and exits.

### Historical ledger backfill

The snapshot fixes *current* state; backfill extends the indexed range *backward*.
The `xrpl-ledger-backfill` PM2 process (or `--mode=backfill`) walks **descending**
from the first indexed ledger (`min(ledger.sequence) - 1`) down to
`INDEXER_BACKFILL_FLOOR` and replays each ledger's transactions into the
append-only history tables (`token_exchange`, `nft_exchange`, NFT mints/burns,
offers, historical `account_balance` rows).

- **Off unless `INDEXER_BACKFILL_FLOOR > 0`.** Set it to an explicit ledger index
  — `32570` for full history, or higher for a window. The dedicated process also
  needs `INDEXER_BACKFILL_ENABLED=true` (the bundled PM2 app sets this; don't set
  it on the live `xrpl-indexer`).
- **Resumable.** Progress is a single `ledger_gap` row whose `range_end` is walked
  downward as a cursor; a crash + PM2 restart resumes from it. When it reaches the
  floor the row is marked `done` and the process idles (re-checking for new ranges
  if you later lower the floor).
- **Append-only.** Backfilled ledgers do **not** write per-ledger
  holder/supply/trustline metric points — those chart series stay anchored at the
  initial snapshot ledger (walking history backward can't reconstruct
  point-in-time values correctly). It also never touches `indexer_checkpoint`.
- **Endpoints:** uses `XRPL_BACKFILL_ENDPOINTS`. Against public full-history
  clusters keep `INDEXER_BACKFILL_CONCURRENCY` at 4–6 (they rate-limit); point it
  at your own full-history node to go faster.
- **Historically burned NFTs** (minted *and* burned before the backfill floor) are
  captured separately by the Bithomp issuer-catalog enrichment path
  (`nft.collection`), which streams each issuer's whole catalog including deleted
  NFTs — no genesis-deep ledger replay needed for NFT coverage.

**Per-process footprint** (steady state, once caught up):

| Process | vCPU | RAM | Notes |
| --- | --- | --- | --- |
| Postgres 16 | 2–8 | most of the box | give it the RAM and the fast disk |
| `apps/indexer` | ~1 | 256–512 MB | ~1 s/ledger measured — keeps up with 3–4 s closes with headroom |
| `apps/api` | 0.5–2 | 256–512 MB | scales with request volume; in-process cache + rate limiter |
| `apps/backfiller` | ~0.25 | 128–256 MB | singleton — one instance only (schedules + discovery + `token.catalog` + `stats.rollup`) |
| `apps/worker` | ~0.25 each | ~256 MB each | fan-out queues; per-queue worker counts via `WORKER_*_CONCURRENCY`; **provider rate limits are the real cap**, not CPU |
| `xrpl-ledger-backfill` | ~0.5 | 256–512 MB | optional; only when `INDEXER_BACKFILL_FLOOR > 0`. Bounded by `XRPL_BACKFILL_ENDPOINTS` rate limits |

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
  services the `discovery.scan` / `stats.rollup` / `token.catalog` singleton
  queues itself). Cheapest to keep it on the indexing box.
- `apps/worker` — run as many as you like, anywhere, each with its own
  `WORKER_QUEUES` and per-queue `WORKER_*_CONCURRENCY`. Each queue registration
  spawns N independent pg-boss polling workers (real parallelism), and the
  fan-out queues use pg-boss `stately` policy so `singletonKey` actually dedupes.

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
| `nft.metadata` | ✅ yes | per-NFT IPFS fallback (long tail); many gateways, `METADATA_IPFS_RPM` caps it per process |
| `token.metadata` | ⚠️ a couple | xrpl.to / xrplmeta fallback for tokens the bulk `token.catalog` missed; the rate limiter is **per process** |
| `nft.collection` | ❌ one box only | primary NFT path — bulk per-issuer Bithomp catalog pull; only that box gets `BITHOMP_API_KEY`, set `BITHOMP_REQUESTS_PER_MINUTE` to the plan cap |
| `token.catalog` / `stats.rollup` / `discovery.scan` | ➖ backfiller only | the singleton box runs these itself; don't add them to any `WORKER_QUEUES` |

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
