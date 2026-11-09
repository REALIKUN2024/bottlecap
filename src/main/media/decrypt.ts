import crypto from "node:crypto";
import { AppError } from "../errors";

export interface DecryptResult {
  data: Buffer;
  keyHex: string;
  samples: number;
  kind: "flac" | "aac";
}

function decodeBase36(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 97 + 10;
  return 0xff;
}

function bitCount(n: number): number {
  let v = n - ((n >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
}

function spadeInner(key: Uint8Array): Uint8Array {
  const out = new Uint8Array(key);
  const buf = new Uint8Array(2 + key.length);
  buf.set([0xfa, 0x55], 0);
  buf.set(key, 2);
  for (let i = 0; i < out.length; i += 1) {
    let v = (key[i] ^ buf[i]) - bitCount(i) - 21;
    while (v < 0) v += 0xff;
    out[i] = v;
  }
  return out;
}

export function spadeKey(spadeA: string): string {
  const bytes = new Uint8Array(Buffer.from(String(spadeA || "").trim(), "base64"));
  if (bytes.length < 3) return "";
  const padding = (bytes[0] ^ bytes[1] ^ bytes[2]) - 48;
  if (padding < 0 || bytes.length < padding + 2) return "";
  const dec = spadeInner(bytes.slice(1, bytes.length - padding));
  if (!dec.length) return "";
  const skip = decodeBase36(dec[0]);
  const end = 1 + (bytes.length - padding - 2) - skip;
  if (end > dec.length || end < 1) return "";
  return Buffer.from(dec.slice(1, end)).toString("utf8");
}

function u32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

export interface Box {
  offset: number;
  size: number;
  headerSize: number;
  data: Buffer;
}

export function findBox(buf: Buffer, type: string, start = 0, end = buf.length): Box | null {
  let pos = start;
  while (pos + 8 <= end) {
    const size = u32(buf, pos);
    const boxType = buf.toString("latin1", pos + 4, pos + 8);
    if (size === 0) {
      return boxType === type ? { offset: pos, size: end - pos, headerSize: 8, data: buf.subarray(pos + 8, end) } : null;
    }
    if (size < 8) break;
    if (size === 1) {
      if (pos + 16 > end) break;
      const large = Number(buf.readBigUInt64BE(pos + 8));
      if (boxType === type) return { offset: pos, size: large, headerSize: 16, data: buf.subarray(pos + 16, pos + large) };
      pos += large;
      continue;
    }
    if (pos + size > end) break;
    if (boxType === type) return { offset: pos, size, headerSize: 8, data: buf.subarray(pos + 8, pos + size) };
    pos += size;
  }
  return null;
}

function mdatStart(buf: Buffer, box: Box): number {
  return box.offset + box.headerSize;
}

function readSamples(audio: Buffer, spadeA: string): { samples: Buffer[]; keyHex: string; stsd: Box; count: number } {
  const keyHex = spadeKey(spadeA);
  if (!/^[a-f0-9]{32}$/i.test(keyHex)) {
    throw new AppError("BAD_KEY", "解密密钥无效（spade_a 异常）", "decrypting", keyHex ? keyHex.slice(0, 8) : "empty");
  }
  const key = Buffer.from(keyHex, "hex");
  const moov = findBox(audio, "moov");
  if (!moov) throw new AppError("MP4_STRUCTURE", "音频容器缺少 moov", "decrypting");
  const trak = findBox(audio, "trak", moov.offset + moov.headerSize, moov.offset + moov.size);
  if (!trak) throw new AppError("MP4_STRUCTURE", "音频容器缺少 trak", "decrypting");
  const mdia = findBox(audio, "mdia", trak.offset + trak.headerSize, trak.offset + trak.size);
  if (!mdia) throw new AppError("MP4_STRUCTURE", "音频容器缺少 mdia", "decrypting");
  const minf = findBox(audio, "minf", mdia.offset + mdia.headerSize, mdia.offset + mdia.size);
  if (!minf) throw new AppError("MP4_STRUCTURE", "音频容器缺少 minf", "decrypting");
  const stbl = findBox(audio, "stbl", minf.offset + minf.headerSize, minf.offset + minf.size);
  if (!stbl) throw new AppError("MP4_STRUCTURE", "音频容器缺少 stbl", "decrypting");
  const stsd = findBox(audio, "stsd", stbl.offset + stbl.headerSize, stbl.offset + stbl.size);
  const stsz = findBox(audio, "stsz", stbl.offset + stbl.headerSize, stbl.offset + stbl.size);
  const senc =
    findBox(audio, "senc", moov.offset + moov.headerSize, moov.offset + moov.size) ||
    findBox(audio, "senc", stbl.offset + stbl.headerSize, stbl.offset + stbl.size);
  const mdat = findBox(audio, "mdat");
  if (!stsd || !stsz || !senc || !mdat) {
    throw new AppError("MP4_STRUCTURE", "音频容器缺少 stsd / stsz / senc / mdat", "decrypting");
  }

  const fixedSize = u32(stsz.data, 4);
  const count = u32(stsz.data, 8);
  if (!count || count > 2_000_000) throw new AppError("MP4_STRUCTURE", "样本数量异常", "decrypting");

  const ivCount = u32(senc.data, 4);
  if (ivCount !== count) {
    throw new AppError("MP4_STRUCTURE", `senc 样本数（${ivCount}）与 stsz（${count}）不一致`, "decrypting");
  }

  const offsets: number[] = [];
  let offset = mdatStart(audio, mdat);
  for (let i = 0; i < count; i += 1) {
    const size = fixedSize || u32(stsz.data, 12 + i * 4);
    offsets.push(size);
  }

  const samples: Buffer[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const iv = Buffer.alloc(16);
    senc.data.copy(iv, 0, 8 + i * 8, 8 + i * 8 + 8);
    const decipher = crypto.createDecipheriv("aes-128-ctr", key, iv);
    samples[i] = Buffer.concat([decipher.update(audio.subarray(offset, offset + offsets[i])), decipher.final()]);
    offset += offsets[i];
  }
  return { samples, keyHex, stsd, count };
}

export function decryptFlac(audio: Buffer, spadeA: string): DecryptResult {
  const { samples, keyHex, stsd, count } = readSamples(audio, spadeA);
  const dfLaIndex = stsd.data.indexOf(Buffer.from("dfLa", "latin1"));
  if (dfLaIndex < 4) throw new AppError("NOT_FLAC", "容器不是 FLAC 编码", "decrypting");
  const dfLaSize = u32(stsd.data, dfLaIndex - 4);
  const dfLa = stsd.data.subarray(dfLaIndex + 4, dfLaIndex - 4 + dfLaSize);
  if (!dfLa.length) throw new AppError("NOT_FLAC", "缺少 FLAC 元数据块", "decrypting");
  const data = Buffer.concat([Buffer.from("fLaC", "latin1"), dfLa.subarray(4), ...samples]);
  return { data, keyHex, samples: count, kind: "flac" };
}

function readDescriptorLength(buf: Buffer, pos: number): { length: number; next: number } {
  let length = 0;
  let cursor = pos;
  for (let i = 0; i < 4 && cursor < buf.length; i += 1) {
    const byte = buf[cursor];
    length = (length << 7) | (byte & 0x7f);
    cursor += 1;
    if ((byte & 0x80) === 0) break;
  }
  return { length, next: cursor };
}

function findAudioSpecificConfig(stsd: Buffer): Buffer | null {
  const esdsIndex = stsd.indexOf(Buffer.from("esds", "latin1"));
  const start = esdsIndex >= 0 ? esdsIndex + 8 : 0;
  for (let i = start; i < stsd.length - 2; i += 1) {
    if (stsd[i] !== 0x05) continue;
    const { length, next } = readDescriptorLength(stsd, i + 1);
    if (length < 2 || length > 8 || next + length > stsd.length) continue;
    const asc = stsd.subarray(next, next + length);
    const objectType = asc[0] >> 3;
    const freqIndex = ((asc[0] & 0x07) << 1) | (asc[1] >> 7);
    const channelConfig = (asc[1] >> 3) & 0x0f;
    if (objectType >= 1 && objectType <= 31 && freqIndex <= 12 && channelConfig >= 1 && channelConfig <= 7) {
      return Buffer.from(asc);
    }
  }
  return null;
}

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function buildAdts(asc: Buffer, samples: Buffer[]): Buffer {
  const objectType = asc[0] >> 3;
  const freqIndex = ((asc[0] & 0x07) << 1) | (asc[1] >> 7);
  let channelConfig = (asc[1] >> 3) & 0x0f;
  if (channelConfig === 0) channelConfig = 2;
  if (!SAMPLE_RATES[freqIndex]) throw new AppError("AAC_ASC", "AAC 采样率配置异常", "decrypting");
  const profile = Math.max(0, Math.min(3, objectType - 1));
  const parts: Buffer[] = [];
  for (const sample of samples) {
    const frameLength = 7 + sample.length;
    const header = Buffer.alloc(7);
    header[0] = 0xff;
    header[1] = 0xf1;
    header[2] = (profile << 6) | (freqIndex << 2) | ((channelConfig >> 2) & 0x01);
    header[3] = ((channelConfig & 0x03) << 6) | ((frameLength >> 11) & 0x03);
    header[4] = (frameLength >> 3) & 0xff;
    header[5] = ((frameLength & 0x07) << 5) | 0x1f;
    header[6] = 0xfc;
    parts.push(header, sample);
  }
  return Buffer.concat(parts);
}

export function decryptAac(audio: Buffer, spadeA: string): DecryptResult {
  const { samples, keyHex, stsd, count } = readSamples(audio, spadeA);
  const asc = findAudioSpecificConfig(stsd.data);
  if (!asc) throw new AppError("AAC_ASC", "没有找到 AAC 配置（esds），无法封装", "decrypting");
  return { data: buildAdts(asc, samples), keyHex, samples: count, kind: "aac" };
}
