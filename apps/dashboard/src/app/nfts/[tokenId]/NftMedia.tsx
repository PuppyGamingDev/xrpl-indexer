"use client";

import { useState } from "react";

const box =
  "flex aspect-square w-full items-center justify-center rounded-lg border border-panel-border bg-[#0b0e14] text-xs text-muted";

const PROXYABLE = /^(ipfs|ar):\/\//i;

/** ipfs:// & ar:// go through the same-origin stream proxy; anything else loads direct. */
function mediaSrc(canonical: string | null, resolved: string | null): string | null {
  if (canonical && PROXYABLE.test(canonical)) return `/api/img?u=${encodeURIComponent(canonical)}`;
  return resolved ?? null;
}

/** Renders an NFT's image or animation, with a graceful fallback. */
export function NftMedia({
  imageUri,
  mediaUri,
  image,
  animation,
  mediaType,
  name,
}: {
  imageUri: string | null;
  mediaUri: string | null;
  image: string | null;
  animation: string | null;
  mediaType: string | null;
  name: string;
}) {
  const [broken, setBroken] = useState(false);

  const vid = mediaSrc(mediaUri, animation);
  const img = mediaSrc(imageUri, image);

  if (!broken && vid && mediaType?.startsWith("video/")) {
    return (
      <video
        src={vid}
        controls
        loop
        muted
        onError={() => setBroken(true)}
        className="w-full rounded-lg border border-panel-border bg-black"
      />
    );
  }

  if (!broken && img) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={img}
        alt={name}
        onError={() => setBroken(true)}
        className="w-full rounded-lg border border-panel-border bg-black"
      />
    );
  }

  return <div className={box}>{broken ? "media unavailable" : "no image"}</div>;
}
