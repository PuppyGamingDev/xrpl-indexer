export type MediaKind = "image" | "video" | "audio" | "model" | "html" | "other";

const EXT: Record<string, MediaKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
  avif: "image", bmp: "image", tiff: "image",
  mp4: "video", webm: "video", mov: "video", m4v: "video", avi: "video", mkv: "video",
  mp3: "audio", wav: "audio", oga: "audio", ogg: "audio", flac: "audio", m4a: "audio",
  glb: "model", gltf: "model", obj: "model",
  html: "html", htm: "html",
};

/** Best-effort media classification from a URL extension and/or a declared MIME. */
export function classifyMediaType(url: string | undefined, declaredType?: string): MediaKind {
  if (declaredType) {
    const t = declaredType.toLowerCase();
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    if (t.startsWith("audio/")) return "audio";
    if (t.startsWith("model/")) return "model";
    if (t.startsWith("text/html")) return "html";
  }
  if (url) {
    const clean = url.split(/[?#]/)[0] ?? "";
    const ext = clean.slice(clean.lastIndexOf(".") + 1).toLowerCase();
    if (ext && EXT[ext]) return EXT[ext]!;
  }
  return "other";
}
