import { InvalidParamError } from "@xrpl-indexer/core/errors";
import { verifyOperator } from "@xrpl-indexer/db";
import { Jobs } from "@xrpl-indexer/jobs";
import type { FastifyInstance } from "fastify";
import { config } from "./config.ts";
import { responseCache } from "./cache.ts";
import { getApiDb } from "./db.ts";
import { accountHoldings, accountNfts } from "./queries/accounts.ts";
import { createApiKey, listApiKeys, patchApiKey, revokeApiKey } from "./queries/admin.ts";
import { parsePage } from "./queries/common.ts";
import { listAmm, listOracles, listVaults } from "./queries/defi.ts";
import { getCollection, getNft, getNftImage, listCollectionNfts, listCollections } from "./queries/nfts.ts";
import { getServerStats, getStatsHistory } from "./queries/stats.ts";
import {
  getMetricSeries,
  getTokenDetail,
  getTokenHolders,
  listTokens,
  resolveToken,
  type MetricName,
} from "./queries/tokens.ts";

const METRICS: MetricName[] = ["price", "trustlines", "holders", "supply", "marketcap"];

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const db = getApiDb();
  const s = (scope: string) => ({ preHandler: app.requireScope(scope) });
  const ttl = config.API_RESPONSE_CACHE_TTL_MS;
  const holdersTtl = config.API_HOLDERS_CACHE_TTL_MS;
  const cached = <T>(key: string, t: number, fn: () => Promise<T>) => responseCache.wrap(key, t, fn);

  let jobs: Jobs | undefined;
  const getJobs = async () => {
    if (!jobs) {
      jobs = new Jobs({ ensureQueues: false });
      await jobs.start();
    }
    return jobs;
  };
  app.addHook("onClose", async () => {
    await jobs?.stop();
  });

  // ---- system ----
  app.get("/healthz", { config: { public: true } }, async () => ({ status: "ok" }));
  app.get("/", async () => ({ name: "xrpl-indexer API", docs: "/docs" }));

  // ---- stats ----
  app.get("/stats", s("stats"), async () => cached("stats", ttl, () => getServerStats(db)));
  app.get("/stats/history", s("stats"), async (req) => {
    const hours = Math.min(Math.max(Number((req.query as { hours?: string }).hours) || 72, 1), 24 * 30);
    return cached(`stats:h:${hours}`, ttl, () => getStatsHistory(db, hours));
  });

  // ---- tokens ----
  app.get("/tokens", s("tokens"), async (req) => {
    const q = req.query as Record<string, string>;
    const page = parsePage(q);
    const sortBy = (["holders", "trustlines", "supply", "priceXrp"].includes(q.sortBy ?? "")
      ? q.sortBy
      : "holders") as "holders" | "trustlines" | "supply" | "priceXrp";
    return cached(`tokens:${JSON.stringify({ q, page })}`, ttl, () =>
      listTokens(db, { ...page, sortBy, issuer: q.issuer, nameLike: q.nameLike }).then((tokens) => ({
        sortBy,
        ...page,
        tokens,
      })),
    );
  });

  app.get("/tokens/:issuer/:currency", s("tokens"), async (req) => {
    const { issuer, currency } = req.params as { issuer: string; currency: string };
    return cached(`token:${issuer}:${currency}`, ttl, async () =>
      getTokenDetail(db, await resolveToken.iou(db, issuer, currency)),
    );
  });

  app.get("/tokens/:issuer/:currency/holders", s("tokens"), async (req) => {
    const { issuer, currency } = req.params as { issuer: string; currency: string };
    const page = parsePage(req.query as Record<string, string>);
    return cached(`token:${issuer}:${currency}:holders:${page.limit}:${page.offset}`, holdersTtl, async () => {
      const ref = await resolveToken.iou(db, issuer, currency);
      return { issuer, currency, ...page, ...(await getTokenHolders(db, ref, page)) };
    });
  });

  app.get("/tokens/:issuer/:currency/series/:metric", s("tokens"), async (req) => {
    const { issuer, currency, metric } = req.params as { issuer: string; currency: string; metric: string };
    if (!METRICS.includes(metric as MetricName)) throw new InvalidParamError(`unknown metric: ${metric}`);
    const q = req.query as Record<string, string>;
    const points = Math.min(Math.max(Number(q.points) || 50, 2), 1000);
    return cached(`token:${issuer}:${currency}:series:${metric}:${JSON.stringify(q)}`, holdersTtl, async () => {
      const ref = await resolveToken.iou(db, issuer, currency);
      return {
        issuer,
        currency,
        ...(await getMetricSeries(db, ref, metric as MetricName, {
          startSequence: q.startSequence ? Number(q.startSequence) : undefined,
          endSequence: q.endSequence ? Number(q.endSequence) : undefined,
          points,
        })),
      };
    });
  });

  // ---- mpts ----
  app.get("/mpts/:mptIssuanceId", s("tokens"), async (req) => {
    const { mptIssuanceId } = req.params as { mptIssuanceId: string };
    return cached(`mpt:${mptIssuanceId}`, ttl, async () =>
      getTokenDetail(db, await resolveToken.mpt(db, mptIssuanceId)),
    );
  });
  app.get("/mpts/:mptIssuanceId/holders", s("tokens"), async (req) => {
    const { mptIssuanceId } = req.params as { mptIssuanceId: string };
    const page = parsePage(req.query as Record<string, string>);
    return cached(`mpt:${mptIssuanceId}:holders:${page.limit}:${page.offset}`, holdersTtl, async () => {
      const ref = await resolveToken.mpt(db, mptIssuanceId);
      return { mptIssuanceId, ...page, ...(await getTokenHolders(db, ref, page)) };
    });
  });
  app.get("/mpts/:mptIssuanceId/series/:metric", s("tokens"), async (req) => {
    const { mptIssuanceId, metric } = req.params as { mptIssuanceId: string; metric: string };
    if (!METRICS.includes(metric as MetricName)) throw new InvalidParamError(`unknown metric: ${metric}`);
    const q = req.query as Record<string, string>;
    const points = Math.min(Math.max(Number(q.points) || 50, 2), 1000);
    const ref = await resolveToken.mpt(db, mptIssuanceId);
    return { mptIssuanceId, ...(await getMetricSeries(db, ref, metric as MetricName, { points })) };
  });

  // ---- nfts + collections ----
  app.get("/nfts/:tokenId", s("nfts"), async (req) => {
    const { tokenId } = req.params as { tokenId: string };
    return cached(`nft:${tokenId}`, ttl, () => getNft(db, tokenId));
  });
  app.get("/nfts/:tokenId/image", s("nfts"), async (req) => {
    const { tokenId } = req.params as { tokenId: string };
    return cached(`nft:${tokenId}:img`, ttl, () => getNftImage(db, tokenId));
  });
  app.get("/collections", s("nfts"), async (req) => {
    const q = req.query as Record<string, string>;
    const page = parsePage(q);
    const sortBy = (["supply", "holders", "trades"].includes(q.sortBy ?? "") ? q.sortBy : "supply") as
      | "supply"
      | "holders"
      | "trades";
    return cached(`cols:${JSON.stringify({ q, page })}`, ttl, () =>
      listCollections(db, { ...page, sortBy, nameLike: q.nameLike }).then((collections) => ({
        sortBy,
        ...page,
        collections,
      })),
    );
  });
  app.get("/collections/:issuer/:taxon", s("nfts"), async (req) => {
    const { issuer, taxon } = req.params as { issuer: string; taxon: string };
    return cached(`col:${issuer}:${taxon}`, ttl, () => getCollection(db, issuer, Number(taxon)));
  });
  app.get("/collections/:issuer/:taxon/nfts", s("nfts"), async (req) => {
    const { issuer, taxon } = req.params as { issuer: string; taxon: string };
    const page = parsePage(req.query as Record<string, string>, 100);
    return cached(`col:${issuer}:${taxon}:nfts:${page.limit}:${page.offset}`, ttl, () =>
      listCollectionNfts(db, issuer, Number(taxon), page).then((nfts) => ({ issuer, taxon: Number(taxon), ...page, nfts })),
    );
  });

  // ---- defi ----
  app.get("/amm", s("amm"), async (req) => {
    const page = parsePage(req.query as Record<string, string>);
    return cached(`amm:${page.limit}:${page.offset}`, ttl, () => listAmm(db, page).then((pools) => ({ ...page, pools })));
  });
  app.get("/vaults", s("vaults"), async (req) => {
    const page = parsePage(req.query as Record<string, string>);
    return cached(`vaults:${page.limit}:${page.offset}`, ttl, () => listVaults(db, page).then((vaults) => ({ ...page, vaults })));
  });
  app.get("/oracles", s("oracles"), async (req) => {
    const page = parsePage(req.query as Record<string, string>);
    return cached(`oracles:${page.limit}:${page.offset}`, ttl, () => listOracles(db, page).then((oracles) => ({ ...page, oracles })));
  });

  // ---- accounts ----
  app.get("/accounts/:address/nfts", s("nfts"), async (req) => {
    const { address } = req.params as { address: string };
    const page = parsePage(req.query as Record<string, string>);
    return { address, ...page, nfts: await accountNfts(db, address, page) };
  });
  app.get("/accounts/:address/tokens", s("tokens"), async (req) => {
    const { address } = req.params as { address: string };
    const page = parsePage(req.query as Record<string, string>);
    return { address, ...page, tokens: await accountHoldings(db, address, "IOU", page) };
  });
  app.get("/accounts/:address/mpts", s("tokens"), async (req) => {
    const { address } = req.params as { address: string };
    const page = parsePage(req.query as Record<string, string>);
    return { address, ...page, mpts: await accountHoldings(db, address, "MPT", page) };
  });

  // ---- admin (dashboard server only) ----
  // Operator login for the (possibly remote / Vercel-hosted) dashboard — double
  // gated: needs the `admin`-scoped API key AND valid operator credentials.
  app.post("/admin/login", s("admin"), async (req, reply) => {
    const b = (req.body ?? {}) as { username?: string; password?: string };
    const operator = await verifyOperator(db, b.username ?? "", b.password ?? "");
    if (!operator) return reply.status(401).send({ error: "invalid credentials", code: "unauthorized" });
    return { ok: true, operator };
  });

  app.get("/admin/keys", s("admin"), async () => ({ keys: await listApiKeys(db) }));
  app.post("/admin/keys", s("admin"), async (req) => {
    const b = (req.body ?? {}) as { label?: string; scopes?: string[]; rateLimit?: number };
    if (!b.label || !Array.isArray(b.scopes)) throw new InvalidParamError("label and scopes[] required");
    return createApiKey(db, { label: b.label, scopes: b.scopes, rateLimit: b.rateLimit });
  });
  app.post("/admin/keys/:id/revoke", s("admin"), async (req) => {
    await revokeApiKey(db, Number((req.params as { id: string }).id));
    return { ok: true };
  });
  app.patch("/admin/keys/:id", s("admin"), async (req) => {
    const b = (req.body ?? {}) as { scopes?: string[]; rateLimit?: number };
    await patchApiKey(db, Number((req.params as { id: string }).id), b);
    return { ok: true };
  });
  app.get("/admin/jobs", s("admin"), async () => {
    const j = await getJobs();
    return { queues: await j.queueDepths() };
  });
}
