import { ForbiddenError, RateLimitedError, UnauthorizedError } from "@xrpl-indexer/core/errors";
import { verifyKey } from "@xrpl-indexer/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { getApiDb } from "./db.ts";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: { id: number; label: string; scopes: string[]; rateLimit: number };
  }
}

const windows = new Map<number, number[]>();

function rateCheck(keyId: number, limit: number): void {
  const now = Date.now();
  const hits = (windows.get(keyId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= limit) {
    const retryAfter = Math.ceil((60_000 - (now - hits[0]!)) / 1000);
    throw new RateLimitedError(retryAfter);
  }
  hits.push(now);
  windows.set(keyId, hits);
}

/** Registers `requireScope(scope)` as a route-level preHandler factory. */
export const authPlugin = fp(async (app) => {
  app.decorate("requireScope", (scope: string) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const presented = req.headers["x-api-key"];
      if (typeof presented !== "string" || !presented) throw new UnauthorizedError();

      const key = req.apiKey ?? (await verifyKey(getApiDb(), presented));
      if (!key) throw new UnauthorizedError();
      req.apiKey = key;

      rateCheck(key.id, key.rateLimit);
      reply.header("x-ratelimit-limit", String(key.rateLimit));

      if (!key.scopes.includes(scope) && !key.scopes.includes("admin")) {
        throw new ForbiddenError(`key is missing scope: ${scope}`);
      }
    };
  });
});

declare module "fastify" {
  interface FastifyInstance {
    requireScope: (scope: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
