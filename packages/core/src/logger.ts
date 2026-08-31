import pino, { type Logger, type LoggerOptions } from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = (process.env.NODE_ENV ?? "development") === "development";

const options: LoggerOptions = {
  level,
  base: undefined, // drop pid/hostname noise; add per-service fields explicitly
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }
    : {}),
};

/** Root logger. Prefer `createLogger(service)` so lines carry a `service` field. */
export const rootLogger: Logger = pino(options);

export function createLogger(service: string, extra?: Record<string, unknown>): Logger {
  return rootLogger.child({ service, ...extra });
}

export type { Logger };
