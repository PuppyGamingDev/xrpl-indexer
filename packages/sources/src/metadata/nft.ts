import { UpstreamError } from "@xrpl-indexer/core/errors";
import { safeFetch } from "../safe-fetch.ts";
import { canonicalizeUri, parseDataUriJson, resolveForFetch, type GatewayConfig } from "../uri.ts";
import { stripNul } from "@xrpl-indexer/codec";
import { classifyMediaType, type MediaKind } from "./media-type.ts";

export interface ParsedNftMetadata {
  name: string | null;
  description: string | null;
  /** Canonical primary-image link (ipfs://, ar://, data:, https://). */
  imageUri: string | null;
  /** Canonical animation / video / audio / model link. */
  mediaUri: string | null;
  mediaType: MediaKind;
  attributes: unknown[] | null;
  collectionName: string | null;
  /** The raw metadata JSON as fetched. */
  raw: Record<string, unknown>;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = stripNul(v).trim();
  return s ? s : null;
}

function pickImage(j: Record<string, unknown>): string | null {
  return str(j.image) ?? str(j.image_url) ?? str(j.imageUrl) ?? str(j.image_data);
}
function pickAnimation(j: Record<string, unknown>): string | null {
  return (
    str(j.animation_url) ??
    str(j.animation) ??
    str(j.video) ??
    str(j.video_url) ??
    str(j.audio) ??
    str(j.audio_url) ??
    str(j.model) ??
    str(j.model_url)
  );
}
function pickCollection(j: Record<string, unknown>): string | null {
  const c = j.collection;
  if (typeof c === "string") return str(c);
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    return str(o.name) ?? str(o.family);
  }
  return str(j.collection_name) ?? str(j.collectionName);
}
function pickAttributes(j: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(j.attributes)) return j.attributes;
  if (Array.isArray(j.traits)) return j.traits;
  return null;
}

/** Normalise an XLS-24 metadata object. Pure — does no I/O. */
export function parseNftMetadata(json: unknown): ParsedNftMetadata {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const image = pickImage(j);
  const animation = pickAnimation(j);
  const imageUri = image ? canonicalizeUri(image) : null;
  const mediaUri = animation ? canonicalizeUri(animation) : null;
  return {
    name: str(j.name),
    description: str(j.description),
    imageUri,
    mediaUri,
    mediaType: classifyMediaType(mediaUri ?? imageUri ?? undefined, str(j.type) ?? undefined),
    attributes: pickAttributes(j),
    collectionName: pickCollection(j),
    raw: j,
  };
}

export interface FetchNftMetadataOptions extends GatewayConfig {
  rotation?: number;
}

/**
 * Resolve an NFT's on-chain URI, fetch the metadata JSON (trying each gateway
 * in turn), and parse it. Never downloads media — only the JSON document.
 */
export async function fetchNftMetadata(
  uri: string,
  opts: FetchNftMetadataOptions,
): Promise<ParsedNftMetadata> {
  const canon = canonicalizeUri(uri);

  if (canon.startsWith("data:")) {
    const json = parseDataUriJson(canon);
    if (json === null) throw new UpstreamError("data: URI did not contain JSON");
    return parseNftMetadata(json);
  }

  const candidates = resolveForFetch(canon, opts, opts.rotation ?? 0);
  if (candidates.length === 0) throw new UpstreamError(`unresolvable metadata URI: ${uri}`);

  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const res = await safeFetch<unknown>(url, { as: "json" });
      if (res.status >= 200 && res.status < 300) return parseNftMetadata(res.data);
      lastErr = new UpstreamError(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new UpstreamError(`all gateways failed for ${uri}`);
}
