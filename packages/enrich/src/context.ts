import type { Db } from "@xrpl-indexer/db";
import type { Jobs } from "@xrpl-indexer/jobs";
import { buildProviders, type GatewayConfig, type ProviderEnv, type ProviderSet } from "@xrpl-indexer/sources";

export interface EnrichConfig extends ProviderEnv {
  ipfsGateways: string[];
  arweaveGateway: string;
  /** Global IPFS/Arweave gateway rate cap (requests/minute, 0 = off). */
  metadataIpfsRpm: number;
}

export interface EnrichContext {
  db: Db;
  jobs: Jobs;
  gateways: GatewayConfig;
  ipfsRpm: number;
  providers: ProviderSet;
}

export function createContext(db: Db, jobs: Jobs, cfg: EnrichConfig): EnrichContext {
  return {
    db,
    jobs,
    gateways: { ipfsGateways: cfg.ipfsGateways, arweaveGateway: cfg.arweaveGateway },
    ipfsRpm: cfg.metadataIpfsRpm,
    providers: buildProviders(cfg),
  };
}
