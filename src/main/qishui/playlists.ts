import { AppError } from "../errors";
import type { PlaylistDetail, PlaylistSummary, TrackSummary } from "../../shared/types";
import type { QishuiClient } from "./client";
import { normalizeTrack } from "./track";

function imageUrl(info: any): string {
  if (!info) return "";
  if (info.uri && Array.isArray(info.urls) && info.urls[0]) {
    const template = info.template_prefix
      ? `${info.template_prefix}-crop-center:600:600.jpg`
      : "c5_600x600.jpg";
    return `${info.urls[0]}${info.uri}~${template}`;
  }
  return info.urls?.[0] || "";
}

function normalizePlaylist(raw: any, kind: "created" | "collected"): PlaylistSummary | null {
  if (!raw) return null;
  const item = raw.playlist || raw;
  if (!item.id) return null;
  return {
    id: String(item.id),
    title: String(item.title || item.name || "未命名歌单"),
    count: Number(item.count_tracks ?? item.track_count ?? item.count ?? 0),
    coverUrl: imageUrl(item.url_cover || item.cover || item.cover_url),
    owner: item.owner?.nickname || item.owner?.name || item.owner_name || "",
    kind,
  };
}

function collectTracks(value: any, out: TrackSummary[], seen: Set<string>, depth = 0): void {
  if (!value || depth > 6 || out.length > 5000) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTracks(item, out, seen, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  if (value.id && value.name && (value.duration || value.duration_ms)) {
    const track = normalizeTrack(value);
    if (track && !seen.has(track.id)) {
      seen.add(track.id);
      out.push(track);
    }
    return;
  }
  for (const key of ["track", "track_wrapper", "entity", "media", "media_resource", "tracks", "media_resources", "items", "list"]) {
    if (value[key]) collectTracks(value[key], out, seen, depth + 1);
  }
}

export class PlaylistService {
  constructor(private readonly client: QishuiClient) {}

  async listMine(myUid?: string): Promise<PlaylistSummary[]> {
    const created: PlaylistSummary[] = [];
    let cursor = "0";
    for (let page = 0; page < 20; page += 1) {
      const json = await this.client.request<any>("/luna/pc/me/playlist", {
        query: { cursor, count: 50 },
      });
      const list = json.playlists || json.data?.playlists || [];
      for (const item of list) {
        const p = normalizePlaylist(item, "created");
        if (p) created.push(p);
      }
      const next = String(json.next_cursor || json.data?.next_cursor || "");
      const hasMore = Boolean(json.has_more ?? json.data?.has_more) && next && next !== cursor;
      if (!hasMore) break;
      cursor = next;
    }

    const collected: PlaylistSummary[] = [];
    try {
      const mixed = await this.client.request<any>("/luna/pc/me/collection/mixed", { query: { cursor: "0", count: 50 } });
      const collections = mixed.mixed_collections || mixed.data?.mixed_collections || [];
      for (const item of collections) {
        const p = normalizePlaylist(item, "collected");
        if (p) {
          const ownerId = item.playlist?.owner?.id;
          if (myUid && ownerId && String(ownerId) === myUid) {
            collected.push({ ...p, kind: "created" });
          } else {
            collected.push(p);
          }
        }
      }
    } catch {
      /* collection endpoint is optional */
    }

    const seen = new Set<string>();
    const merged: PlaylistSummary[] = [];
    for (const item of [...created, ...collected]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    return merged;
  }

  async detail(playlistId: string): Promise<PlaylistDetail> {
    const tracks: TrackSummary[] = [];
    const seen = new Set<string>();
    let cursor = "0";
    let title = "";
    let coverUrl = "";
    let owner = "";
    let count = 0;
    let hasMore = false;
    let nextCursor = "";

    for (let page = 0; page < 40; page += 1) {
      const json = await this.client.request<any>("/luna/pc/playlist/detail", {
        query: { playlist_id: playlistId, cursor, count: 50, only_need_media: "false" },
      });
      const playlist = json.playlist || json.data?.playlist;
      if (playlist) {
        title = title || String(playlist.title || playlist.name || "");
        coverUrl = coverUrl || imageUrl(playlist.url_cover || playlist.cover);
        owner = owner || playlist.owner?.nickname || "";
        count = count || Number(playlist.count_tracks ?? playlist.track_count ?? 0);
      }
      collectTracks(json.media_resources || json.tracks || json.data?.media_resources || json.data?.tracks, tracks, seen);
      hasMore = Boolean(json.has_more ?? json.data?.has_more);
      nextCursor = String(json.next_cursor ?? json.data?.next_cursor ?? "");
      if (!hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    if (!title && !tracks.length) {
      throw new AppError("PLAYLIST_EMPTY", "这个歌单没有返回内容，可能没有权限或接口已变化", "fetching");
    }
    return { id: playlistId, title: title || "歌单", coverUrl, owner, count: count || tracks.length, tracks, hasMore, nextCursor };
  }
}
