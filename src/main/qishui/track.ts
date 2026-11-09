import { AppError } from "../errors";
import type { TrackDetail, TrackSummary, Variant } from "../../shared/types";
import type { QishuiClient } from "./client";

function imageUrl(info: any): string {
  if (!info) return "";
  if (info.uri && Array.isArray(info.urls) && info.urls[0]) {
    const template = info.template_prefix
      ? `${info.template_prefix}-crop-center:1000:1000.jpg`
      : "c5_1000x1000.jpg";
    return `${info.urls[0]}${info.uri}~${template}`;
  }
  return info.urls?.[0] || "";
}

export function normalizeTrack(raw: any): TrackSummary | null {
  if (!raw) return null;
  const source = raw.track || raw.entity?.track || raw.media?.track || raw;
  if (!source || !source.id || !source.name) return null;
  const artists = Array.isArray(source.artists)
    ? source.artists.map((a: any) => a?.simple_display_name || a?.name || a?.nickname).filter(Boolean)
    : [];
  return {
    id: String(source.id),
    name: String(source.name),
    artists,
    album: source.album?.name || source.album_name || "",
    durationMs: Number(source.duration) || Number(source.duration_ms) || 0,
    coverUrl: imageUrl(source.album?.url_cover || source.album?.url_avatar || source.url_cover),
  };
}

function normalizeVariant(raw: any): Variant | null {
  if (!raw?.main_url) return null;
  const meta = raw.video_meta || {};
  return {
    codec: String(meta.codec_type || meta.vtype || "unknown"),
    bitrate: Number(meta.bitrate || meta.real_bitrate) || 0,
    sampleRate: meta.audio_sample_rate ? Number(meta.audio_sample_rate) : undefined,
    size: meta.size ? Number(meta.size) : undefined,
    url: String(raw.main_url),
    backupUrl: raw.backup_url ? String(raw.backup_url) : undefined,
    spadeA: String(raw.encrypt_info?.spade_a || ""),
    quality: meta.quality,
  };
}

export function pickVariant(variants: Variant[], prefer: "flac" | "aac" = "flac"): Variant | null {
  const order = prefer === "flac" ? ["flac"] : ["aac", "flac"];
  for (const codec of order) {
    const list = variants.filter((v) => v.codec === codec && v.url);
    if (list.length) return [...list].sort((a, b) => b.bitrate - a.bitrate)[0];
  }
  return variants.filter((v) => v.url).sort((a, b) => b.bitrate - a.bitrate)[0] || null;
}

export class TrackService {
  constructor(private readonly client: QishuiClient) {}

  async resolveInput(input: string): Promise<string> {
    const text = input.trim();
    const direct = text.match(/^\d{15,20}$/);
    if (direct) return direct[0];

    const embedded = text.match(/(?<!\d)(\d{18,20})(?!\d)/);
    if (embedded && !/^https?:\/\//.test(text)) return embedded[1];

    if (/^https?:\/\//.test(text)) {
      let html = "";
      try {
        const response = await fetch(text, {
          redirect: "follow",
          headers: {
            "user-agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          },
          signal: AbortSignal.timeout(20000),
        });
        html = await response.text();
      } catch (error) {
        throw new AppError("SHARE_FETCH", "打不开分享链接，请检查链接或直接粘贴 19 位 track_id", "resolving", String(error));
      }
      const patterns = [
        /"track_id"\s*:\s*"?(\d{15,20})"?/,
        /"trackId"\s*:\s*"?(\d{15,20})"?/,
        /track_id=(\d{15,20})/,
        /\/share\/track\/(\d{15,20})/,
        /"id"\s*:\s*"(\d{18,20})"/,
        /(?<!\d)(\d{18,20})(?!\d)/,
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return match[1];
      }
      throw new AppError("SHARE_PARSE", "没能从分享页里解析出 track_id，请直接粘贴 19 位数字", "resolving");
    }

    if (embedded) return embedded[1];
    throw new AppError("INPUT_INVALID", "请输入汽水分享链接或 19 位 track_id", "resolving");
  }

  async fetchDetail(trackId: string): Promise<TrackDetail> {
    const json = await this.client.request<any>("/luna/pc/track_v2", {
      method: "POST",
      body: { track_id: trackId, media_type: "track", queue_type: "search_one_track", scene_name: "search" },
    });
    const rawTrack = json.track;
    const summary = normalizeTrack(rawTrack);
    if (!summary) throw new AppError("TRACK_EMPTY", "接口没有返回曲目信息", "resolving");

    let model: any = {};
    try {
      model = JSON.parse(json.track_player?.video_model || "{}");
    } catch {
      model = {};
    }
    const variants = (model.video_list || []).map(normalizeVariant).filter(Boolean) as Variant[];
    if (!variants.length) throw new AppError("NO_VARIANT", "这首没有可用的音频变体", "resolving");

    const streamMs = Math.round((Number(model.video_duration) || 0) * 1000);
    const preview = Boolean(summary.durationMs && streamMs && streamMs + 2000 < summary.durationMs);
    const qualities = Array.isArray(rawTrack?.bit_rates)
      ? rawTrack.bit_rates.map((b: any) => ({ br: Number(b.br) || 0, quality: String(b.quality || "") }))
      : [];

    return {
      ...summary,
      variants,
      preview,
      streamDurationMs: streamMs,
      lyric: json.lyric?.content || "",
      vipOnly: Boolean(rawTrack?.label_info?.only_vip_playable),
      qualities,
    };
  }

  async search(query: string, cursor = "0"): Promise<{ tracks: TrackSummary[]; hasMore: boolean; cursor: string }> {
    const q = query.trim();
    if (!q) return { tracks: [], hasMore: false, cursor: "0" };
    const json = await this.client.request<any>("/luna/pc/search/track", {
      query: { q, query: q, cursor, count: 20, search_id: "" },
      signed: true,
    });
    const groups = Array.isArray(json.result_groups) ? json.result_groups : [];
    const group = groups.find((item: any) => item?.id === "tracks") || groups[0];
    const arrays = [
      group?.data,
      json.tracks,
      json.track_list,
      json.data?.tracks,
      json.data?.track_list,
      json.search_list,
      json.items,
      json.data?.items,
      json.result?.tracks,
    ].filter(Array.isArray) as any[][];
    const rawList = arrays[0] || [];
    const tracks: TrackSummary[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      const track = normalizeTrack(item);
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        tracks.push(track);
      }
    }
    const next = String(group?.next_cursor ?? json.next_cursor ?? json.data?.next_cursor ?? "");
    const hasMore = Boolean(group?.has_more ?? json.has_more ?? json.data?.has_more) && Boolean(next);
    return { tracks, hasMore, cursor: next || "0" };
  }
}
