export type Format = "original" | "flac" | "mp3" | "wav";

export type Stage =
  | "queued"
  | "resolving"
  | "signing"
  | "fetching"
  | "downloading"
  | "decrypting"
  | "packaging"
  | "transcoding"
  | "tagging"
  | "done"
  | "failed"
  | "paused"
  | "canceled";

export interface TrackSummary {
  id: string;
  name: string;
  artists: string[];
  album?: string;
  durationMs: number;
  coverUrl?: string;
  bitrate?: number;
  codec?: string;
}

export interface Variant {
  codec: string;
  bitrate: number;
  sampleRate?: number;
  size?: number;
  url: string;
  backupUrl?: string;
  spadeA: string;
  quality?: string;
}

export interface TrackDetail extends TrackSummary {
  variants: Variant[];
  preview: boolean;
  streamDurationMs?: number;
  lyric?: string;
  vipOnly?: boolean;
  qualities?: { br: number; quality: string }[];
}

export interface Task {
  id: string;
  trackId: string;
  name: string;
  artists: string[];
  album?: string;
  coverUrl?: string;
  durationMs: number;
  format: Format;
  stage: Stage;
  progress: number;
  bytesDone: number;
  bytesTotal: number;
  speedBps: number;
  codec?: string;
  bitrate?: number;
  error?: { code: string; message: string; stage: Stage };
  outputPath?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type AuthSource = "client" | "qr" | "saved" | null;

export interface AuthState {
  connected: boolean;
  checking: boolean;
  source: AuthSource;
  nickname?: string;
  avatar?: string;
  uid?: string;
  isVip?: boolean;
  vipStage?: string;
  deviceId?: string;
  clientVersion?: string;
  message?: string;
}

export interface Settings {
  outputDir: string;
  format: Format;
  mp3Bitrate: number;
  concurrency: number;
  writeTags: boolean;
  embedLyrics: boolean;
  writeLrc: boolean;
  filenameTemplate: string;
  clientDir: string;
  ffmpegPath: string;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  count: number;
  coverUrl?: string;
  owner?: string;
  kind: "created" | "collected";
}

export interface PlaylistDetail {
  id: string;
  title: string;
  coverUrl?: string;
  owner?: string;
  count: number;
  tracks: TrackSummary[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface HistoryEntry {
  id: string;
  trackId: string;
  name: string;
  artists: string[];
  album?: string;
  coverUrl?: string;
  format: Format;
  path: string;
  size: number;
  durationMs: number;
  finishedAt: number;
}

export interface QrSession {
  token: string;
  qrcode: string;
  expiresAt: number;
  indexUrl?: string;
}

export interface QrStatus {
  status: "new" | "scanned" | "confirmed" | "expired" | "error";
  message?: string;
  auth?: AuthState;
}

export interface ClientProbe {
  found: boolean;
  dir?: string;
  version?: string;
  hasBdms?: boolean;
  hasDevice?: boolean;
  hasCookie?: boolean;
  ffmpeg?: boolean;
  node?: string;
  electron?: string;
}

export interface QueueSnapshot {
  tasks: Task[];
  concurrency: number;
}

export interface PreviewSource {
  trackId: string;
  url: string;
  codec: string;
  durationMs: number;
  previewOnly: boolean;
}

export type PreviewStage = "resolving" | "downloading" | "decrypting" | "packaging" | "ready" | "error";

export interface PreviewProgress {
  trackId: string;
  stage: PreviewStage;
  progress: number;
  message?: string;
}

export const IPC = {
  authStatus: "auth:status",
  authLocal: "auth:local",
  authQrStart: "auth:qr-start",
  authQrPoll: "auth:qr-poll",
  authLogout: "auth:logout",
  trackResolve: "track:resolve",
  search: "search:query",
  playlistsList: "playlists:list",
  playlistsDetail: "playlists:detail",
  downloadsEnqueue: "downloads:enqueue",
  downloadsPause: "downloads:pause",
  downloadsResume: "downloads:resume",
  downloadsCancel: "downloads:cancel",
  downloadsRetry: "downloads:retry",
  downloadsRemove: "downloads:remove",
  downloadsReveal: "downloads:reveal",
  queueSnapshot: "queue:snapshot",
  queueClearFinished: "queue:clear-finished",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsChooseDir: "settings:choose-dir",
  historyList: "history:list",
  historyRemove: "history:remove",
  historyClear: "history:clear",
  historyReveal: "history:reveal",
  previewStart: "preview:start",
  previewDispose: "preview:dispose",
  probe: "app:probe",
  openPath: "app:open-path",
  windowMin: "window:min",
  windowMax: "window:max",
  windowClose: "window:close",
  log: "app:log",
} as const;

export const EVT = {
  queue: "evt:queue",
  auth: "evt:auth",
  toast: "evt:toast",
  preview: "evt:preview",
} as const;
