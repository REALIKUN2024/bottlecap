import fs from "node:fs";
import path from "node:path";
import type { Format } from "../../shared/types";

export function sanitizeFilename(input: string): string {
  return input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 180)
    .trim() || "未命名";
}

export function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(artist|title|album|trackId)\}/g, (_, key: string) => values[key] ?? "");
}

export function extensionFor(format: Format, sourceKind: "flac" | "aac"): string {
  if (format === "original") return sourceKind === "flac" ? "flac" : "m4a";
  if (format === "flac") return "flac";
  if (format === "wav") return "wav";
  return "mp3";
}

export function uniquePath(dir: string, base: string, extension: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const clean = sanitizeFilename(base);
  let candidate = path.join(dir, `${clean}.${extension}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${clean} (${index}).${extension}`);
    index += 1;
  }
  return candidate;
}

export function baseNameFor(template: string, track: { name: string; artists: string[]; album?: string; id: string }): string {
  return applyTemplate(template, {
    artist: track.artists.join(", ") || "未知歌手",
    title: track.name || "未命名",
    album: track.album || "",
    trackId: track.id,
  });
}
