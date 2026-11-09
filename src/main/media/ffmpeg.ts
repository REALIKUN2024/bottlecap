import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { AppError } from "../errors";
import type { Format } from "../../shared/types";

let cachedFfmpeg: string | null | undefined;
let cachedFfprobe: string | null | undefined;

function existsFile(file: string | undefined): file is string {
  return Boolean(file && fs.existsSync(file));
}

function fromPath(name: string): string | null {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(command, [name], { encoding: "utf8", windowsHide: true });
    const first = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

export function resolveFfmpeg(override?: string): string | null {
  if (override && existsFile(override)) return override;
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    path.join(process.resourcesPath || "", "bin", exe),
    path.join(app.getAppPath(), "resources", "bin", exe),
    fromPath("ffmpeg"),
  ].filter(Boolean) as string[];
  cachedFfmpeg = candidates.find(existsFile) || null;
  return cachedFfmpeg;
}

export function resolveFfprobe(override?: string): string | null {
  if (override && existsFile(override)) return override;
  if (cachedFfprobe !== undefined) return cachedFfprobe;
  const exe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const candidates = [
    path.join(process.resourcesPath || "", "bin", exe),
    path.join(app.getAppPath(), "resources", "bin", exe),
    fromPath("ffprobe"),
  ].filter(Boolean) as string[];
  cachedFfprobe = candidates.find(existsFile) || null;
  return cachedFfprobe;
}

function run(executable: string, args: string[], timeoutMs = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError("FFMPEG_TIMEOUT", "音频处理超时", "transcoding"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new AppError("FFMPEG_SPAWN", "无法启动 ffmpeg", "transcoding", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new AppError("FFMPEG_FAILED", "音频转码失败", "transcoding", stderr.slice(-800)));
    });
  });
}

export interface TagMeta {
  title: string;
  artist: string;
  album?: string;
  lyrics?: string;
}

export interface ProduceOptions {
  input: string;
  output: string;
  sourceKind: "flac" | "aac";
  format: Format;
  bitrate: number;
  meta: TagMeta;
  coverPath?: string;
  ffmpegPath?: string;
}

export async function produceAudio(options: ProduceOptions): Promise<void> {
  const ffmpeg = resolveFfmpeg(options.ffmpegPath);
  if (!ffmpeg) {
    throw new AppError("FFMPEG_MISSING", "找不到 ffmpeg，请在设置里指定 ffmpeg.exe 路径", "transcoding");
  }

  const target = options.format === "original" ? (options.sourceKind === "flac" ? "flac" : "m4a") : options.format;
  const useCover = target !== "wav" && Boolean(options.coverPath) && fs.existsSync(options.coverPath!);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", options.input];

  if (useCover) {
    args.push("-i", options.coverPath!);
    args.push("-map", "0:a:0", "-map", "1:v:0", "-c:v", "copy", "-disposition:v", "attached_pic");
    args.push("-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
  } else {
    args.push("-map", "0:a:0");
  }

  if (target === "mp3") {
    args.push("-c:a", "libmp3lame", "-b:a", `${options.bitrate}k`, "-id3v2_version", "3", "-write_id3v1", "1");
  } else if (target === "wav") {
    args.push("-c:a", "pcm_s16le");
  } else if (target === "m4a") {
    args.push("-c:a", "copy", "-bsf:a", "aac_adtstoasc", "-f", "ipod");
  } else if (target === "flac") {
    args.push("-c:a", options.sourceKind === "flac" ? "copy" : "flac");
  }

  args.push("-map_metadata", "-1");
  args.push("-metadata", `title=${options.meta.title}`);
  args.push("-metadata", `artist=${options.meta.artist}`);
  if (options.meta.album) args.push("-metadata", `album=${options.meta.album}`);
  if (options.meta.lyrics && target !== "wav") args.push("-metadata", `lyrics=${options.meta.lyrics}`);
  args.push("-metadata", "encoder=Bottlecap");
  args.push(options.output);

  await run(ffmpeg, args);
}

export interface ProbeResult {
  durationSec: number;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  bitrate?: number;
}

export async function probeAudio(file: string, ffprobePath?: string): Promise<ProbeResult> {
  const ffprobe = resolveFfprobe(ffprobePath);
  if (!ffprobe) return { durationSec: 0 };
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => reject(new AppError("FFPROBE_SPAWN", "无法启动 ffprobe", "tagging", error.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError("FFPROBE_FAILED", "音频校验失败", "tagging", stderr.slice(-400)));
        return;
      }
      try {
        const json = JSON.parse(stdout);
        const audioStream = (json.streams || []).find((s: any) => s.codec_type === "audio") || {};
        resolve({
          durationSec: Number(json.format?.duration || audioStream.duration || 0),
          codec: audioStream.codec_name,
          sampleRate: audioStream.sample_rate ? Number(audioStream.sample_rate) : undefined,
          channels: audioStream.channels ? Number(audioStream.channels) : undefined,
          bitrate: json.format?.bit_rate ? Number(json.format.bit_rate) : undefined,
        });
      } catch (error) {
        reject(new AppError("FFPROBE_PARSE", "无法解析音频信息", "tagging", String(error)));
      }
    });
  });
}
