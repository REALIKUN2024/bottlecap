import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { app } from "electron";
import { AppError } from "./errors";
import type { ClientPaths } from "./paths";
import type { AuthManager } from "./qishui/auth";
import type { DeviceIdentity } from "./qishui/identity";
import { QishuiClient, USER_AGENT } from "./qishui/client";
import { TrackService, pickVariant } from "./qishui/track";
import type { Store } from "./store";
import { decryptAac, decryptFlac } from "./media/decrypt";
import { produceAudio } from "./media/ffmpeg";
import type { PreviewProgress, PreviewSource } from "../shared/types";

interface PreviewDeps {
  store: Store;
  auth: AuthManager;
  resolveClient: () => ClientPaths | null;
  identity: DeviceIdentity;
}

interface Entry {
  token: string;
  trackId: string;
  file: string;
  dir: string;
  mime: string;
  size: number;
  createdAt: number;
  source: PreviewSource;
}

const TTL_MS = 30 * 60 * 1000;

export class PreviewManager extends EventEmitter {
  private readonly tempDir = path.join(app.getPath("temp"), "bottlecap-preview");
  private readonly entries = new Map<string, Entry>();
  private readonly byTrack = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<PreviewSource>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: PreviewDeps) {
    super();
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  async start(trackId: string): Promise<PreviewSource> {
    const cached = this.byTrack.get(trackId);
    if (cached && fs.existsSync(cached.file)) return cached.source;
    const inflight = this.pending.get(trackId);
    if (inflight) return inflight;

    const promise = this.prepare(trackId)
      .finally(() => this.pending.delete(trackId));
    this.pending.set(trackId, promise);
    return promise;
  }

  private async prepare(trackId: string): Promise<PreviewSource> {
    const controller = new AbortController();
    this.controllers.set(trackId, controller);
    let workDir = "";
    try {
      this.emitProgress(trackId, "resolving", 4);
      const session = this.deps.auth.requireSession();
      const clientPaths = this.deps.resolveClient();
      if (!clientPaths) {
        throw new AppError("CLIENT_MISSING", "没找到汽水音乐客户端，无法试听", "resolving");
      }
      const client = new QishuiClient(clientPaths, this.deps.identity, session);
      const detail = await new TrackService(client).fetchDetail(trackId);
      if (controller.signal.aborted) throw new AppError("PREVIEW_CANCELED", "已取消试听", "resolving");

      const variant = pickVariant(detail.variants, "flac");
      if (!variant) throw new AppError("NO_VARIANT", "这首没有可试听的音频", "resolving");

      workDir = fs.mkdtempSync(path.join(this.tempDir, "p-"));
      const encryptedFile = path.join(workDir, "encrypted.mp4");
      await this.download(variant.url, encryptedFile, trackId, controller.signal);
      if (controller.signal.aborted) throw new AppError("PREVIEW_CANCELED", "已取消试听", "downloading");

      this.emitProgress(trackId, "decrypting", 82);
      const encrypted = fs.readFileSync(encryptedFile);
      const decoded = variant.codec === "flac" ? decryptFlac(encrypted, variant.spadeA) : decryptAac(encrypted, variant.spadeA);

      this.emitProgress(trackId, "packaging", 92);
      let file: string;
      let mime: string;
      if (decoded.kind === "flac") {
        file = path.join(workDir, "preview.flac");
        fs.writeFileSync(file, decoded.data);
        mime = "audio/flac";
      } else {
        const raw = path.join(workDir, "preview.aac");
        fs.writeFileSync(raw, decoded.data);
        file = path.join(workDir, "preview.m4a");
        await produceAudio({
          input: raw,
          output: file,
          sourceKind: "aac",
          format: "original",
          bitrate: 320,
          meta: { title: detail.name, artist: detail.artists.join(", "), album: detail.album },
          ffmpegPath: this.deps.store.getSettings().ffmpegPath,
        });
        mime = "audio/mp4";
      }

      const token = crypto.randomBytes(16).toString("hex");
      const source: PreviewSource = {
        trackId,
        url: `bottlecap-preview://${token}`,
        codec: decoded.kind,
        durationMs: detail.streamDurationMs || detail.durationMs,
        previewOnly: detail.preview,
      };
      const entry: Entry = {
        token,
        trackId,
        file,
        dir: workDir,
        mime,
        size: fs.statSync(file).size,
        createdAt: Date.now(),
        source,
      };
      this.entries.set(token, entry);
      this.byTrack.set(trackId, entry);
      this.emitProgress(trackId, "ready", 100);
      this.cleanupOld();
      return source;
    } catch (error) {
      if (workDir) {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      if (!(error instanceof AppError) || error.code !== "PREVIEW_CANCELED") {
        const message = error instanceof Error ? error.message : String(error);
        this.emitProgress(trackId, "error", 0, message);
      }
      throw error;
    } finally {
      this.controllers.delete(trackId);
    }
  }

  dispose(trackId: string): void {
    this.controllers.get(trackId)?.abort();
    const entry = this.byTrack.get(trackId);
    if (!entry) return;
    this.byTrack.delete(trackId);
    this.entries.delete(entry.token);
    try {
      fs.rmSync(entry.dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  cleanupAll(): void {
    for (const entry of this.entries.values()) {
      try {
        fs.rmSync(entry.dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    this.entries.clear();
    this.byTrack.clear();
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  async serve(request: Request): Promise<Response> {
    let token = "";
    try {
      token = new URL(request.url).hostname;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const entry = this.entries.get(token);
    if (!entry || !fs.existsSync(entry.file)) return new Response("Not found", { status: 404 });

    const stat = fs.statSync(entry.file);
    const range = request.headers.get("range");
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        if (match[1]) start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
        else if (match[1]) end = stat.size - 1;
        if (!match[1] && match[2]) {
          start = Math.max(0, stat.size - Number(match[2]));
          end = stat.size - 1;
        }
        if (start > end || start >= stat.size) {
          return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${stat.size}` } });
        }
        end = Math.min(end, stat.size - 1);
        status = 206;
      }
    }

    const headers: Record<string, string> = {
      "content-type": entry.mime,
      "accept-ranges": "bytes",
      "content-length": String(end - start + 1),
      "cache-control": "no-store",
    };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    if (request.method === "HEAD") return new Response(null, { status, headers });

    const nodeStream = fs.createReadStream(entry.file, { start, end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new Response(webStream, { status, headers });
  }

  private async download(url: string, destination: string, trackId: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal });
    if (!response.ok || !response.body) {
      throw new AppError("DOWNLOAD_HTTP", `试听音频下载失败（HTTP ${response.status}）`, "downloading");
    }
    const total = Number(response.headers.get("content-length")) || 0;
    const reader = response.body.getReader();
    const stream = fs.createWriteStream(destination);
    let done = 0;
    let lastAt = Date.now();
    let lastEmit = 0;
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        if (!value) continue;
        done += value.byteLength;
        if (!stream.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
        }
        const now = Date.now();
        if (now - lastAt > 200 || now - lastEmit > 100) {
          const progress = total ? Math.min(78, 8 + (done / total) * 70) : 40;
          this.emitProgress(trackId, "downloading", progress);
          lastAt = now;
          lastEmit = now;
        }
      }
    } finally {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    }
    if (!done) throw new AppError("DOWNLOAD_EMPTY", "试听音频为空", "downloading");
  }

  private emitProgress(trackId: string, stage: PreviewProgress["stage"], progress: number, message?: string): void {
    this.emit("progress", { trackId, stage, progress, message } satisfies PreviewProgress);
  }

  private cleanupOld(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (now - entry.createdAt < TTL_MS) continue;
      this.entries.delete(token);
      this.byTrack.delete(entry.trackId);
      try {
        fs.rmSync(entry.dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
