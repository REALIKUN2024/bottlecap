import type { Format, Stage, Task, TrackDetail, TrackSummary } from "../../../shared/types";

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function fmtLongDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function fmtSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  return `${fmtBytes(bytesPerSecond)}/s`;
}

export function fmtBitrate(value?: number): string {
  if (!value) return "—";
  return value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`;
}

export function fmtDate(timestamp: number): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function fmtDay(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "今天";
  if (same(date, yesterday)) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export const STAGE_TEXT: Record<Stage, string> = {
  queued: "排队中",
  resolving: "解析中",
  signing: "签名中",
  fetching: "取流中",
  downloading: "下载中",
  decrypting: "解密中",
  packaging: "封装中",
  transcoding: "转码中",
  tagging: "写入标签",
  done: "完成",
  failed: "失败",
  paused: "已暂停",
  canceled: "已取消",
};

export const ACTIVE_STAGES: Stage[] = ["resolving", "signing", "fetching", "downloading", "decrypting", "packaging", "transcoding", "tagging"];

export function isActive(task: Task): boolean {
  return ACTIVE_STAGES.includes(task.stage) || task.stage === "queued";
}

export function stageIndex(stage: Stage): number {
  if (stage === "queued") return -1;
  if (stage === "resolving" || stage === "signing" || stage === "fetching") return 0;
  if (stage === "downloading") return 2;
  if (stage === "decrypting") return 3;
  if (stage === "packaging" || stage === "transcoding" || stage === "tagging") return 4;
  if (stage === "done") return 5;
  return -1;
}

export function summaryOf(detail: TrackDetail): TrackSummary {
  return {
    id: detail.id,
    name: detail.name,
    artists: detail.artists,
    album: detail.album,
    durationMs: detail.durationMs,
    coverUrl: detail.coverUrl,
  };
}

export function formatLabel(format: Format): string {
  if (format === "original") return "原格式";
  return format.toUpperCase();
}

export function extLabel(format: Format, codec?: string): string {
  if (format === "original") return codec === "aac" ? "M4A" : "FLAC";
  return format.toUpperCase();
}

export function initials(text: string): string {
  return (text || "?").trim().slice(0, 2);
}

export function toneFor(text: string): { from: string; to: string } {
  const palettes = [
    { from: "#D8D0BE", to: "#B9C6BC" },
    { from: "#CFD8D1", to: "#AFC0B4" },
    { from: "#DFD3C3", to: "#C6B7A2" },
    { from: "#D3CBC0", to: "#B8B0A4" },
    { from: "#C8D4CE", to: "#A6B8AE" },
  ];
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length];
}
