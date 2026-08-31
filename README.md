# xrpl-indexer

A self-hosted XRP Ledger indexer, REST API, backfiller, and dashboard in one monorepo.
Full plan: [`../.claude/plans/okay-so-on-another-hidden-zephyr.md`](../.claude/plans/okay-so-on-another-hidden-zephyr.md).

## Packages

| Path | Purpose |
| --- | --- |
| `packages/core` | zod config loader, pino logger, shared errors + domain types |
| `packages/codec` | XRPL codecs — address, currency, NFT tokenId, MPT issuance id, XLS-24/89 |
| `packages/db` | Drizzle schema + migrations + typed client + API-key helpers |
| `packages/xrpl-client` | rippled/Clio connection pool + ledger subscription/fetch |
| `packages/sources` | SSRF-hardened fetch, IPFS/Arweave resolver, metadata normalizer, providers |
| `packages/jobs` | pg-boss wrapper — queue names, typed payloads, helpers |
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

## Conventions

- **No media is ever downloaded.** Enrichment stores the canonical source link
  (`ipfs://<cid>/<path>`, `ar://…`, `data:`, `https://`) — consumers pick a gateway.
- **API keys never reach the browser.** The dashboard calls the API only from the
  server (RSC + Route Handlers); keys live in server-only env vars.
- Money is stored as Postgres `numeric` — XFL never enters storage.
- TypeScript is run directly via `tsx` / Next; packages export `src/*.ts`, no build step.
