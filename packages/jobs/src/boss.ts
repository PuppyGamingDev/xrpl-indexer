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

/**
 * Per-queue tuning applied on start (only when `ensureQueues`). `stately` makes
 * `singletonKey` actually enforce "one live job per key" (the default `standard`
 * policy silently ignores it), which is what stops discovery re-flooding the
 * queue with duplicates every scan. Short retention frees keys again quickly;
 * the error-retry cadence is gated by `*_meta.error` / `fetched_at` in SQL, not
 * by pg-boss.
 */
const QUEUE_TUNING: Partial<Record<QueueName, PgBoss.Queue>> = {
  "nft.metadata": {
    name: "nft.metadata",
    policy: "stately",
    retryLimit: 2,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionMinutes: 60,
  },
  "token.metadata": {
    name: "token.metadata",
    policy: "stately",
    retryLimit: 2,
    expireInSeconds: 120,
    retentionMinutes: 60,
  },
  "nft.collection": {
    name: "nft.collection",
    policy: "stately",
    retryLimit: 1,
    expireInSeconds: 1800,
    retentionMinutes: 180,
  },
  "token.catalog": {
    name: "token.catalog",
    policy: "stately",
    retryLimit: 1,
    expireInSeconds: 1800,
    retentionMinutes: 180,
  },
  // Periodic recompute — one at a time; if a run overruns the cron interval,
  // extra fires collapse instead of stacking a backlog.
  "stats.rollup": {
    name: "stats.rollup",
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 1800,
    retentionMinutes: 30,
  },
  // Same — a slow scan must not let the next cron fire stack another.
  "discovery.scan": {
    name: "discovery.scan",
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 1800,
    retentionMinutes: 30,
  },
};

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
      for (const q of ALL_QUEUES) {
        const tuning = QUEUE_TUNING[q];
        await this.boss.createQueue(q, tuning ?? { name: q });
        // createQueue is a no-op if the queue already exists, so push the tuning
        // through explicitly for queues that predate this config.
        if (tuning) await this.boss.updateQueue(q, tuning);
      }
    }
    this.started = true;
    log.info({ queues: ALL_QUEUES }, "jobs started");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true });
    this.started = false;
  }

  /** Enqueue one job. `key` (singletonKey) dedupes live jobs on `stately` queues. */
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

  /**
   * Register `concurrency` independent workers for a queue. pg-boss has no
   * in-process concurrency knob (a single `work()` polls and runs its batch
   * serially), so real parallelism = N separate polling workers, each pulling
   * one job at a time. On `stately` queues pg-boss still guarantees at most one
   * live job per `singletonKey`, so different keys run in parallel while a
   * duplicate key waits.
   */
  async work<N extends QueueName>(
    name: N,
    opts: (PgBoss.WorkOptions & { concurrency?: number }) | undefined,
    handler: JobHandler<N>,
  ): Promise<string[]> {
    const { concurrency = 1, ...workOpts } = opts ?? {};
    const runOne = async (jobs: PgBoss.Job<JobPayloads[N]>[]): Promise<void> => {
      for (const job of jobs) {
        try {
          await handler(job.data, job);
        } catch (err) {
          log.error({ err, queue: name, jobId: job.id }, "job handler threw");
          throw err; // let pg-boss record the failure + apply the retry policy
        }
      }
    };

    const ids: string[] = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) {
      ids.push(
        await this.boss.work<JobPayloads[N]>(
          name,
          { batchSize: 1, pollingIntervalSeconds: 1, ...workOpts },
          runOne,
        ),
      );
    }
    return ids;
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
