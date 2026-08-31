import type { Db } from "@xrpl-indexer/db";
import type { Jobs } from "@xrpl-indexer/jobs";
import { buildProviders, type GatewayConfig, type ProviderEnv } from "@xrpl-indexer/sources";

export interface EnrichConfig extends ProviderEnv {
  ipfsGateways: string[];
  arweaveGateway: string;
}

export interface EnrichContext {
  db: Db;
  jobs: Jobs;
  gateways: GatewayConfig;
  providers: ReturnType<typeof buildProviders>;
}

export function createContext(db: Db, jobs: Jobs, cfg: EnrichConfig): EnrichContext {
  return {
    db,
    jobs,
    gateways: { ipfsGateways: cfg.ipfsGateways, arweaveGateway: cfg.arweaveGateway },
    providers: buildProviders(cfg),
  };
}
