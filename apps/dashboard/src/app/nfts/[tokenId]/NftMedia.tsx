"use client";

import { useState } from "react";

const box =
  "flex aspect-square w-full items-center justify-center rounded-lg border border-panel-border bg-[#0b0e14] text-xs text-muted";

/** Renders an NFT's image or animation from a public gateway URL, with a graceful fallback. */
export function NftMedia({
  image,
  animation,
  mediaType,
  name,
}: {
  image: string | null;
  animation: string | null;
  mediaType: string | null;
  name: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!broken && animation && mediaType?.startsWith("video/")) {
    return (
      <video
        src={animation}
        controls
        loop
        muted
        onError={() => setBroken(true)}
        className="w-full rounded-lg border border-panel-border bg-black"
      />
    );
  }

  if (!broken && image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={name}
        onError={() => setBroken(true)}
        className="w-full rounded-lg border border-panel-border bg-black"
      />
    );
  }

  return <div className={box}>{broken ? "media unavailable" : "no image"}</div>;
}
