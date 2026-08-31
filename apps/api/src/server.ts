import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { isAppError } from "@xrpl-indexer/core/errors";
import { createLogger } from "@xrpl-indexer/core/logger";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "./auth.ts";
import { registerRoutes } from "./routes.ts";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    ajv: { customOptions: { coerceTypes: true, removeAdditional: true } },
  });
  const log = createLogger("api");

  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: { title: "xrpl-indexer API", version: "0.1.0" },
      components: {
        securitySchemes: { apiKey: { type: "apiKey", name: "x-api-key", in: "header" } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await app.register(authPlugin);

  app.setErrorHandler((err: unknown, req, reply) => {
    if (isAppError(err)) {
      if (err.status === 429 && "retryAfterSeconds" in err) {
        reply.header("retry-after", String((err as { retryAfterSeconds: number }).retryAfterSeconds));
      }
      return reply.status(err.status).send({ error: err.message, code: err.code });
    }
    const e = err as { validation?: unknown; message?: string };
    if (e.validation) {
      return reply.status(400).send({ error: e.message ?? "invalid parameter", code: "invalid_param" });
    }
    log.error({ err, url: req.url }, "unhandled error");
    return reply.status(500).send({ error: "internal error", code: "internal_error" });
  });

  app.addHook("onResponse", (req, reply, done) => {
    log.info(
      { method: req.method, url: req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      "req",
    );
    done();
  });

  await registerRoutes(app);
  return app;
}
