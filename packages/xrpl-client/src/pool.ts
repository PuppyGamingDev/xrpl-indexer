import { createLogger, type Logger } from "@xrpl-indexer/core/logger";
import { Client } from "xrpl";
import type { ExpandedTransaction, FullLedger, ValidatedLedger } from "./types.ts";

export interface XrplClientOptions {
  /** ws(s) endpoints, tried in order with failover. Clio preferred for history. */
  endpoints: string[];
  logger?: Logger;
  /** Per-connect timeout. */
  connectionTimeoutMs?: number;
  /** Base delay for reconnect backoff. */
  reconnectBaseMs?: number;
}

type LedgerHandler = (ledger: ValidatedLedger) => void;

/**
 * A resilient wrapper over xrpl.js `Client` that fails over across multiple
 * rippled/Clio endpoints and re-subscribes to the `ledger` stream on reconnect.
 */
export class XrplClient {
  private readonly endpoints: string[];
  private readonly log: Logger;
  private readonly connectionTimeoutMs: number;
  private readonly reconnectBaseMs: number;

  private client: Client;
  private endpointIdx = 0;
  private started = false;
  private closing = false;
  private readonly ledgerHandlers = new Set<LedgerHandler>();

  constructor(opts: XrplClientOptions) {
    if (opts.endpoints.length === 0) throw new Error("XrplClient: no endpoints configured");
    this.endpoints = [...opts.endpoints];
    this.log = opts.logger ?? createLogger("xrpl-client");
    this.connectionTimeoutMs = opts.connectionTimeoutMs ?? 15_000;
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 1_000;
    this.client = this.makeClient(this.endpoints[0]!);
  }

  get endpoint(): string {
    return this.endpoints[this.endpointIdx]!;
  }

  private makeClient(url: string): Client {
    const c = new Client(url, { connectionTimeout: this.connectionTimeoutMs });
    c.on("ledgerClosed", (ev: unknown) => {
      const l = normalizeStreamLedger(ev);
      if (l) for (const h of this.ledgerHandlers) h(l);
    });
    c.on("error", (err) => this.log.warn({ err, endpoint: url }, "xrpl client error"));
    c.on("disconnected", (code) => {
      if (this.closing) return;
      this.log.warn({ code, endpoint: url }, "xrpl disconnected; will reconnect");
      void this.reconnect();
    });
    return c;
  }

  async connect(): Promise<void> {
    this.started = true;
    this.closing = false;
    await this.connectWithFailover();
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    this.started = false;
    await this.client.disconnect().catch(() => {});
  }

  private async connectWithFailover(): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const url = this.endpoint;
      try {
        if (!this.client.isConnected()) await this.client.connect();
        await this.client.request({ command: "subscribe", streams: ["ledger"] });
        this.log.info({ endpoint: url }, "xrpl connected + subscribed to ledger stream");
        return;
      } catch (err) {
        lastErr = err;
        this.log.warn({ err, endpoint: url }, "xrpl connect failed; rotating endpoint");
        await this.rotateEndpoint();
      }
    }
    throw new Error(`XrplClient: all endpoints failed to connect: ${String(lastErr)}`);
  }

  private async rotateEndpoint(): Promise<void> {
    await this.client.disconnect().catch(() => {});
    this.endpointIdx = (this.endpointIdx + 1) % this.endpoints.length;
    this.client = this.makeClient(this.endpoint);
  }

  private reconnecting?: Promise<void>;
  private async reconnect(): Promise<void> {
    if (!this.started || this.closing) return;
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      for (let attempt = 1; ; attempt++) {
        if (this.closing) return;
        const delay = Math.min(this.reconnectBaseMs * 2 ** Math.min(attempt, 6), 30_000);
        await sleep(delay);
        try {
          await this.connectWithFailover();
          return;
        } catch (err) {
          this.log.warn({ err, attempt }, "xrpl reconnect attempt failed");
        }
      }
    })().finally(() => {
      this.reconnecting = undefined;
    });
    return this.reconnecting;
  }

  /** Subscribe to validated-ledger notifications. Returns an unsubscribe fn. */
  onValidatedLedger(handler: LedgerHandler): () => void {
    this.ledgerHandlers.add(handler);
    return () => this.ledgerHandlers.delete(handler);
  }

  /** Raw request with one automatic failover+retry. */
  async request<T = unknown>(req: Record<string, unknown>): Promise<T> {
    try {
      const res = await this.client.request(req as never);
      return (res as { result: T }).result;
    } catch (err) {
      this.log.warn({ err, command: req.command }, "request failed; rotating + retrying once");
      await this.rotateEndpoint();
      await this.client.connect();
      await this.client.request({ command: "subscribe", streams: ["ledger"] });
      const res = await this.client.request(req as never);
      return (res as { result: T }).result;
    }
  }

  /** Fetch a full ledger with every transaction + its metadata expanded. */
  async fetchLedger(ledgerIndex: number | "validated"): Promise<FullLedger> {
    const result = await this.request<{ ledger: RawLedger }>({
      command: "ledger",
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
    });
    return normalizeFullLedger(result.ledger);
  }

  /**
   * One page of `ledger_data` — the raw ledger objects at a given ledger.
   * `ledgerNotFound` is true when the node doesn't retain that ledger's state.
   */
  async ledgerData(params: {
    ledgerIndex: number;
    type?: string;
    marker?: unknown;
    limit?: number;
  }): Promise<{ state: LedgerDataEntry[]; marker?: unknown; ledgerNotFound: boolean }> {
    const req: Record<string, unknown> = {
      command: "ledger_data",
      ledger_index: params.ledgerIndex,
      binary: false,
      limit: params.limit ?? 2048,
    };
    if (params.type) req.type = params.type;
    if (params.marker !== undefined) req.marker = params.marker;
    try {
      const result = await this.request<{ state?: LedgerDataEntry[]; marker?: unknown }>(req);
      return { state: result.state ?? [], marker: result.marker, ledgerNotFound: false };
    } catch (err) {
      if (String((err as { data?: { error?: string } })?.data?.error ?? err).includes("lgrNotFound")) {
        return { state: [], ledgerNotFound: true };
      }
      throw err;
    }
  }
}

/** A raw ledger entry as returned by `ledger_data` (fields as they are on-ledger). */
export type LedgerDataEntry = Record<string, unknown> & {
  LedgerEntryType: string;
  index: string;
};

interface RawLedger {
  ledger_hash: string;
  ledger_index: number | string;
  parent_hash: string;
  close_time: number;
  close_time_iso?: string;
  transactions?: unknown[];
}

function normalizeFullLedger(raw: RawLedger): FullLedger {
  const ledgerIndex = typeof raw.ledger_index === "string" ? Number(raw.ledger_index) : raw.ledger_index;
  const transactions: ExpandedTransaction[] = (raw.transactions ?? [])
    .map((entry) => {
      const e = entry as Record<string, unknown>;
      const meta = (e.metaData ?? e.meta) as ExpandedTransaction["meta"];
      // rippled/Clio return either `tx_json` (current API) or the tx fields spread
      // onto the entry (legacy `expand:true`).
      const { metaData: _m, meta: _mm, tx_json: txJson, hash, ...spread } = e;
      const base = (txJson as Record<string, unknown> | undefined) ?? spread;
      return {
        tx: { ...base, hash: (hash ?? base.hash) as string } as ExpandedTransaction["tx"],
        meta,
        validated: true,
      };
    })
    // The `ledger` command returns transactions sorted by id, NOT execution
    // order. `meta.TransactionIndex` is the applied order — sort by it so that
    // "last write wins" within a ledger yields the true final state.
    .sort(
      (a, b) =>
        ((a.meta as { TransactionIndex?: number })?.TransactionIndex ?? 0) -
        ((b.meta as { TransactionIndex?: number })?.TransactionIndex ?? 0),
    );
  return {
    ledgerIndex,
    ledgerHash: raw.ledger_hash,
    parentHash: raw.parent_hash,
    closeTimeRipple: raw.close_time,
    closeTimeIso: raw.close_time_iso ?? new Date((raw.close_time + 946_684_800) * 1000).toISOString(),
    transactions,
  };
}

function normalizeStreamLedger(ev: unknown): ValidatedLedger | null {
  const e = ev as Record<string, unknown>;
  if (typeof e.ledger_index !== "number") return null;
  return {
    ledgerIndex: e.ledger_index,
    ledgerHash: String(e.ledger_hash ?? ""),
    parentHash: String(e.parent_hash ?? ""),
    closeTimeRipple: Number(e.ledger_time ?? 0),
    txnCount: Number(e.txn_count ?? 0),
    reserveBaseDrops: typeof e.reserve_base === "number" ? e.reserve_base : undefined,
    reserveIncDrops: typeof e.reserve_inc === "number" ? e.reserve_inc : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
