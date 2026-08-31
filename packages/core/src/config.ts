import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Load the nearest `.env` into `process.env` (no-op if absent). Call once at
 * process start, before `defineConfig`. Real env vars always win over the file.
 */
export function loadEnv(cwd = process.cwd()): void {
  for (const dir of [cwd, resolve(cwd, ".."), resolve(cwd, "../..")]) {
    const p = resolve(dir, ".env");
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        /* malformed .env — ignore, rely on real env */
      }
      return;
    }
  }
}

/** Common fields every service shares. Spread into an app-specific schema. */
export const baseEnvSchema = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DATABASE_URL: z.string().url(),
};

/**
 * Validate `process.env` against `shape` and return a typed, frozen config.
 * Exits the process with a readable report on failure.
 */
export function defineConfig<T extends z.ZodRawShape>(shape: T): Readonly<z.infer<z.ZodObject<T>>> {
  const parsed = z.object(shape).safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export { z };
