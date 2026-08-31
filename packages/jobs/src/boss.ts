import { createLogger } from "@xrpl-indexer/core/logger";
import PgBoss from "pg-boss";
import { ALL_QUEUES, type JobPayloads, type QueueName } from "./queues.ts";

const log = createLogger("jobs");

export interface JobsOptions {
  databaseUrl?: string;
  /** Create every known queue on start (idempotent). Default true. */
  ensureQueues?: boolean;
}

export type JobHandler<N extends QueueName> = (
  data: JobPayloads[N],
  job: PgBoss.Job<JobPayloads[N]>,
) => Promise<void>;

/** Thin typed wrapper over pg-boss with our queue registry baked in. */
export class Jobs {
  readonly boss: PgBoss;
  private started = false;

  constructor(opts: JobsOptions = {}) {
    const url = opts.databaseUrl ?? process.env.DATABASE_URL;
    if (!url) throw new Error("Jobs: DATABASE_URL not set");
    this.boss = new PgBoss({ connectionString: url, schema: "pgboss" });
    this.boss.on("error", (err) => log.error({ err }, "pg-boss error"));
    this.ensureQueues = opts.ensureQueues ?? true;
  }
  private readonly ensureQueues: boolean;

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    if (this.ensureQueues) {
      for (const q of ALL_QUEUES) await this.boss.createQueue(q);
    }
    this.started = true;
    log.info({ queues: ALL_QUEUES }, "jobs started");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true });
    this.started = false;
  }

  /** Enqueue one job. `key` (singletonKey) dedupes pending jobs. */
  async enqueue<N extends QueueName>(
    name: N,
    data: JobPayloads[N],
    opts: PgBoss.SendOptions & { key?: string } = {},
  ): Promise<string | null> {
    const { key, ...send } = opts;
    return this.boss.send(name, data, key ? { ...send, singletonKey: key } : send);
  }

  /** Bulk enqueue. */
  async enqueueMany<N extends QueueName>(
    name: N,
    rows: { data: JobPayloads[N]; key?: string }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.boss.insert(
      rows.map((r) => ({ name, data: r.data, singletonKey: r.key })),
    );
  }

  /** Register a worker for a queue. */
  async work<N extends QueueName>(
    name: N,
    opts: PgBoss.WorkOptions,
    handler: JobHandler<N>,
  ): Promise<string> {
    return this.boss.work<JobPayloads[N]>(name, opts, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data, job);
      }
    });
  }

  /** Cron-schedule a recurring job. */
  async schedule<N extends QueueName>(
    name: N,
    cron: string,
    data: JobPayloads[N],
  ): Promise<void> {
    await this.boss.schedule(name, cron, data);
  }

  async queueDepths(): Promise<Record<string, { queued: number; active: number }>> {
    const out: Record<string, { queued: number; active: number }> = {};
    for (const q of ALL_QUEUES) {
      const size = await this.boss.getQueueSize(q);
      out[q] = { queued: size, active: 0 };
    }
    return out;
  }
}

export { PgBoss };
