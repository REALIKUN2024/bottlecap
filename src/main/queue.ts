import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError, toAppError } from "./errors";
import { AuthManager } from "./qishui/auth";
import { QishuiClient, USER_AGENT } from "./qishui/client";
import type { DeviceIdentity } from "./qishui/identity";
import type { ClientPaths } from "./paths";
import { TrackService, pickVariant } from "./qishui/track";
import { Store } from "./store";
import type { Format, HistoryEntry, Task, TrackSummary } from "../shared/types";
import { decryptAac, decryptFlac } from "./media/decrypt";
import { produceAudio, probeAudio } from "./media/ffmpeg";
import { baseNameFor, extensionFor, uniquePath } from "./media/naming";
import { formatLrcFile, parseQrc } from "./media/lyrics";

interface QueueDeps {
  store: Store;
  auth: AuthManager;
  resolveClient: () => ClientPaths | null;
  identity: DeviceIdentity;
}

interface Runtime {
  abort?: AbortController;
  pauseRequested?: boolean;
  cancelRequested?: boolean;
  speedBytes?: number;
  speedAt?: number;
}

export class QueueManager extends EventEmitter {
  private tasks = new Map<string, Task>();
  private runtime = new Map<string, Runtime>();
  private running = 0;
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: QueueDeps) {
    super();
  }

  notifySettingsChanged(): void {
    this.emitUpdate(true);
    this.pump();
  }

  snapshot(): { tasks: Task[]; concurrency: number } {
    return {
      tasks: [...this.tasks.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((task) => ({ ...task })),
      concurrency: this.deps.store.getSettings().concurrency,
    };
  }

  enqueue(tracks: TrackSummary[], format?: Format): Task[] {
    const settings = this.deps.store.getSettings();
    const created: Task[] = [];
    for (const track of tracks) {
      const active = [...this.tasks.values()].find(
        (task) => task.trackId === track.id && !["done", "failed", "canceled"].includes(task.stage),
      );
      if (active) continue;
      const task: Task = {
        id: crypto.randomUUID(),
        trackId: track.id,
        name: track.name,
        artists: track.artists,
        album: track.album,
        coverUrl: track.coverUrl,
        durationMs: track.durationMs,
        format: format || settings.format,
        stage: "queued",
        progress: 0,
        bytesDone: 0,
        bytesTotal: 0,
        speedBps: 0,
        createdAt: Date.now(),
      };
      this.tasks.set(task.id, task);
      created.push(task);
    }
    this.emitUpdate(true);
    this.pump();
    return created;
  }

  pause(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.stage === "queued") {
      task.stage = "paused";
      this.emitUpdate(true);
      return;
    }
    const runtime = this.runtime.get(id);
    if (runtime) {
      runtime.pauseRequested = true;
      runtime.abort?.abort();
    }
  }

  resume(id: string): void {
    const task = this.tasks.get(id);
    if (!task || !["paused", "canceled", "failed"].includes(task.stage)) return;
    this.resetTask(task);
    this.emitUpdate(true);
    this.pump();
  }

  retry(id: string): void {
    this.resume(id);
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.stage === "queued") {
      task.stage = "canceled";
      task.progress = 0;
      this.emitUpdate(true);
      return;
    }
    const runtime = this.runtime.get(id);
    if (runtime) {
      runtime.cancelRequested = true;
      runtime.abort?.abort();
    }
  }

  remove(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (["downloading", "decrypting", "packaging", "transcoding", "tagging", "resolving"].includes(task.stage)) return;
    this.tasks.delete(id);
    this.runtime.delete(id);
    this.emitUpdate(true);
  }

  clearFinished(): void {
    for (const [id, task] of this.tasks) {
      if (["done", "failed", "canceled"].includes(task.stage)) this.tasks.delete(id);
    }
    this.emitUpdate(true);
  }

  private resetTask(task: Task): void {
    task.stage = "queued";
    task.progress = 0;
    task.bytesDone = 0;
    task.bytesTotal = 0;
    task.speedBps = 0;
    task.error = undefined;
    task.outputPath = undefined;
    task.startedAt = undefined;
    task.finishedAt = undefined;
  }

  private emitUpdate(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) {
        clearTimeout(this.emitTimer);
        this.emitTimer = null;
      }
      this.emit("update", this.snapshot());
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit("update", this.snapshot());
    }, 120);
  }

  private pump(): void {
    const concurrency = Math.max(1, Math.min(4, this.deps.store.getSettings().concurrency));
    while (this.running < concurrency) {
      const next = [...this.tasks.values()].find((task) => task.stage === "queued");
      if (!next) break;
      this.running += 1;
      void this.run(next).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private setStage(task: Task, stage: Task["stage"], progress: number): void {
    task.stage = stage;
    task.progress = Math.max(task.progress, progress);
    task.progress = Math.min(100, task.progress);
    this.emitUpdate();
  }

  private async run(task: Task): Promise<void> {
    const runtime: Runtime = {};
    this.runtime.set(task.id, runtime);
    runtime.abort = new AbortController();
    task.startedAt = Date.now();
    const settings = this.deps.store.getSettings();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bottlecap-"));
    let source: { kind: "flac" | "aac"; file: string; lyric?: string; meta: { title: string; artist: string; album?: string; coverUrl?: string } } | null = null;

    try {
      const session = this.deps.auth.requireSession();
      const clientPaths = this.deps.resolveClient();
      if (!clientPaths) {
        throw new AppError("CLIENT_MISSING", "没找到汽水音乐客户端，请先安装并登录客户端，或在设置里指定目录", "resolving");
      }
      const client = new QishuiClient(clientPaths, this.deps.identity, session);
      const trackService = new TrackService(client);

      this.setStage(task, "resolving", 2);
      const detail = await trackService.fetchDetail(task.trackId);
      if (detail.preview) {
        throw new AppError(
          "PREVIEW_ONLY",
          `这首歌只返回了试听片段（${((detail.streamDurationMs || 0) / 1000).toFixed(1)}s / ${(detail.durationMs / 1000).toFixed(1)}s），当前账号没有完整播放权限`,
          "resolving",
        );
      }
      const variant = pickVariant(detail.variants, "flac");
      if (!variant) throw new AppError("NO_VARIANT", "没有可用的音频变体", "resolving");
      task.codec = variant.codec;
      task.bitrate = variant.bitrate;
      task.bytesTotal = variant.size || 0;
      this.emitUpdate(true);

      this.setStage(task, "downloading", 6);
      const encryptedFile = path.join(tempDir, "encrypted.mp4");
      await this.download(variant.url, encryptedFile, task, runtime);
      if (runtime.pauseRequested) throw new AppError("PAUSED", "已暂停", "paused");
      if (runtime.cancelRequested) throw new AppError("CANCELED", "已取消", "canceled");

      this.setStage(task, "decrypting", 86);
      const encrypted = fs.readFileSync(encryptedFile);
      const decoded = variant.codec === "flac" ? decryptFlac(encrypted, variant.spadeA) : decryptAac(encrypted, variant.spadeA);

      this.setStage(task, "packaging", 91);
      const baseName = baseNameFor(settings.filenameTemplate, {
        id: detail.id,
        name: detail.name,
        artists: detail.artists,
        album: detail.album,
      });
      const extension = extensionFor(task.format, decoded.kind);
      const finalPath = uniquePath(settings.outputDir, baseName, extension);
      const sourceFile = path.join(tempDir, decoded.kind === "flac" ? "decoded.flac" : "decoded.aac");
      fs.writeFileSync(sourceFile, decoded.data);

      let coverPath: string | undefined;
      if (settings.writeTags && detail.coverUrl) {
        coverPath = path.join(tempDir, "cover.jpg");
        try {
          await this.downloadFile(detail.coverUrl, coverPath, runtime.abort.signal);
        } catch {
          coverPath = undefined;
        }
      }

      const parsed = parseQrc(detail.lyric || "");
      const meta = {
        title: detail.name,
        artist: detail.artists.join(", ") || "未知歌手",
        album: detail.album,
        lyrics: settings.embedLyrics ? parsed.plain : undefined,
      };

      const needsFfmpeg =
        task.format !== "original" ||
        decoded.kind === "aac" ||
        Boolean(settings.writeTags && (coverPath || settings.embedLyrics));

      this.setStage(task, "transcoding", 94);
      if (needsFfmpeg) {
        const tempOutput = path.join(settings.outputDir, `.bottlecap-${task.id}.${extension}`);
        fs.mkdirSync(settings.outputDir, { recursive: true });
        try {
          await produceAudio({
            input: sourceFile,
            output: tempOutput,
            sourceKind: decoded.kind,
            format: task.format,
            bitrate: settings.mp3Bitrate,
            meta: {
              title: meta.title,
              artist: meta.artist,
              album: meta.album,
              lyrics: meta.lyrics,
            },
            coverPath,
            ffmpegPath: settings.ffmpegPath,
          });
          fs.renameSync(tempOutput, finalPath);
        } catch (error) {
          try {
            fs.rmSync(tempOutput, { force: true });
          } catch {
            /* ignore */
          }
          throw error;
        }
      } else {
        fs.copyFileSync(sourceFile, finalPath);
      }

      this.setStage(task, "tagging", 98);
      if (settings.writeLrc && parsed.lrc) {
        const lrcPath = finalPath.replace(/\.[^.]+$/, ".lrc");
        fs.writeFileSync(lrcPath, formatLrcFile(parsed.lrc, meta.title, meta.artist), "utf8");
      }

      let durationSec = 0;
      try {
        const probed = await probeAudio(finalPath, settings.ffmpegPath);
        durationSec = probed.durationSec;
      } catch {
        /* probe is best effort */
      }
      if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024) {
        throw new AppError("OUTPUT_EMPTY", "输出文件为空，写入失败", "tagging");
      }

      task.outputPath = finalPath;
      task.bytesDone = fs.statSync(finalPath).size;
      task.finishedAt = Date.now();
      this.setStage(task, "done", 100);
      task.progress = 100;
      this.emitUpdate(true);

      const entry: HistoryEntry = {
        id: task.id,
        trackId: task.trackId,
        name: task.name,
        artists: task.artists,
        album: task.album,
        coverUrl: task.coverUrl,
        format: task.format,
        path: finalPath,
        size: task.bytesDone,
        durationMs: Math.round((durationSec || task.durationMs / 1000) * 1000),
        finishedAt: task.finishedAt,
      };
      this.deps.store.addHistory(entry);
      this.emit("history", this.deps.store.getHistory());
    } catch (error) {
      const appError = toAppError(error);
      if (runtime.pauseRequested || appError.code === "PAUSED") {
        task.stage = "paused";
        task.progress = 0;
        task.error = undefined;
      } else if (runtime.cancelRequested || appError.code === "CANCELED") {
        task.stage = "canceled";
        task.error = undefined;
      } else {
        task.stage = "failed";
        task.error = { code: appError.code, message: appError.message, stage: appError.stage || "resolving" };
      }
      task.speedBps = 0;
      task.finishedAt = Date.now();
      this.emitUpdate(true);
    } finally {
      this.runtime.delete(task.id);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  private async download(url: string, destination: string, task: Task, runtime: Runtime): Promise<void> {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: runtime.abort?.signal,
    });
    if (!response.ok || !response.body) {
      throw new AppError("DOWNLOAD_HTTP", `下载失败（HTTP ${response.status}）`, "downloading");
    }
    const total = Number(response.headers.get("content-length")) || task.bytesTotal || 0;
    task.bytesTotal = total;
    const reader = response.body.getReader();
    const stream = fs.createWriteStream(destination);
    let done = 0;
    let lastAt = Date.now();
    let lastBytes = 0;
    runtime.speedAt = lastAt;
    runtime.speedBytes = 0;
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
        if (now - lastAt > 200) {
          const speed = ((done - lastBytes) * 1000) / (now - lastAt);
          task.speedBps = speed;
          task.bytesDone = done;
          if (task.bytesTotal) task.progress = Math.min(85, 8 + (done / task.bytesTotal) * 76);
          this.emitUpdate();
          lastAt = now;
          lastBytes = done;
        }
      }
    } finally {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    }
    task.bytesDone = done;
    if (!done) throw new AppError("DOWNLOAD_EMPTY", "下载到的文件为空", "downloading");
  }

  private async downloadFile(url: string, destination: string, signal?: AbortSignal): Promise<void> {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal });
    if (!response.ok || !response.body) throw new Error("cover download failed");
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destination, buffer);
  }
}
