import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise, Check, DownloadSimple, MusicNotes, Play, WarningCircle } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useApp } from "../store";
import { fmtDuration, formatLabel } from "../lib/format";
import type { PlaylistDetail } from "../../../shared/types";
import { Badge, Cover, EmptyState, Spinner } from "../components/ui";

export default function PlaylistsPage() {
  const auth = useApp((state) => state.auth);
  const settings = useApp((state) => state.settings);
  const playlists = useApp((state) => state.playlists);
  const setPlaylists = useApp((state) => state.setPlaylists);
  const pushToast = useApp((state) => state.pushToast);
  const setLoginOpen = useApp((state) => state.setLoginOpen);
  const startPreview = useApp((state) => state.startPreview);

  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const loadList = useCallback(async () => {
    if (!auth?.connected) return;
    setLoadingList(true);
    setError("");
    try {
      const list = await api.playlists.list();
      setPlaylists(list);
      setSelectedId((current) => (list.some((item) => item.id === current) ? current : list[0]?.id || ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "歌单加载失败");
    } finally {
      setLoadingList(false);
    }
  }, [auth?.connected, setPlaylists]);

  useEffect(() => {
    if (auth?.connected) void loadList();
    else {
      setPlaylists([]);
      setSelectedId("");
      setDetail(null);
    }
  }, [auth?.connected, loadList, setPlaylists]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setError("");
    setSelection(new Set());
    api.playlists
      .detail(selectedId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "歌单详情加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectedTracks = useMemo(
    () => (detail ? detail.tracks.filter((track) => selection.has(track.id)) : []),
    [detail, selection],
  );

  const toggle = (id: string) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!detail) return;
    setSelection((current) => (current.size === detail.tracks.length ? new Set() : new Set(detail.tracks.map((track) => track.id))));
  };

  const enqueue = async (ids: string[]) => {
    if (!detail) return;
    const tracks = detail.tracks.filter((track) => ids.includes(track.id));
    if (!tracks.length) return;
    try {
      await api.downloads.enqueue(tracks, settings?.format);
      pushToast(`已加入 ${tracks.length} 首 · ${formatLabel(settings?.format || "original")}`);
      setSelection(new Set());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "加入队列失败", "error");
    }
  };

  if (!auth?.connected) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>歌单</h1>
            <p>登录后展示账号创建与收藏的全部歌单，可整单或勾选下载。</p>
          </div>
        </div>
        <EmptyState
          icon={MusicNotes}
          title="还没有连接账号"
          description="扫码登录后，这里会列出你的歌单。登录凭据只留在本机。"
          actions={<button className="btn btn-primary" onClick={() => setLoginOpen(true)}>连接账号</button>}
        />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>歌单</h1>
          <p>账号里的全部歌单；勾选后按当前输出格式批量入队。</p>
        </div>
        <div className="spacer" />
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => void loadList()} disabled={loadingList}>
            {loadingList ? <Spinner label="刷新" /> : <><ArrowClockwise size={15} /> 刷新</>}
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-inline">
          <WarningCircle size={16} />
          <div className="grow"><b>加载失败。</b>{error}</div>
          <button className="text-btn" onClick={() => void loadList()}>重试</button>
        </div>
      ) : null}

      {loadingList && !playlists.length ? (
        <div className="loading-block">
          {Array.from({ length: 6 }).map((_, index) => <div className="skeleton" key={index} />)}
        </div>
      ) : playlists.length ? (
        <div className="split">
          <div className="playlist-index" aria-label="歌单列表">
            {playlists.map((playlist) => (
              <button key={playlist.id} className={`pl-item ${playlist.id === selectedId ? "on" : ""}`} onClick={() => setSelectedId(playlist.id)}>
                <div className="pl-cover"><Cover url={playlist.coverUrl} title={playlist.title} /></div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{playlist.title}</div>
                  <div className="c">{playlist.kind === "collected" ? "收藏" : "创建"}{playlist.owner ? ` · ${playlist.owner}` : ""}</div>
                </div>
                <div className="c">{playlist.count}</div>
              </button>
            ))}
          </div>

          <div>
            {loadingDetail ? (
              <div className="loading-block">
                <div className="skeleton" style={{ height: 132 }} />
                {Array.from({ length: 6 }).map((_, index) => <div className="skeleton" key={index} />)}
              </div>
            ) : detail ? (
              <>
                <div className="playlist-hero">
                  <div className="art"><Cover url={detail.coverUrl} title={detail.title} /></div>
                  <div style={{ minWidth: 0 }}>
                    <h2>{detail.title}</h2>
                    <div className="meta">
                      <span className="mono">{detail.tracks.length} 首</span>
                      {detail.owner ? <><span className="sep" />{detail.owner}</> : null}
                      <Badge>{formatLabel(settings?.format || "original")}</Badge>
                    </div>
                    <div className="actions">
                      <button className="btn btn-primary" onClick={() => void enqueue(detail.tracks.map((track) => track.id))}>
                        <DownloadSimple size={15} /> 全部下载
                      </button>
                      <button className="btn btn-ghost" onClick={toggleAll}>
                        {selection.size === detail.tracks.length ? "取消全选" : "全选"}
                      </button>
                    </div>
                  </div>
                </div>

                {selection.size ? (
                  <div className="batchbar">
                    <span className="mono">{selection.size}</span>
                    <span>首已选择</span>
                    <div className="spacer" />
                    <button className="btn btn-primary" style={{ height: 32 }} onClick={() => void enqueue([...selection])}>
                      加入队列
                    </button>
                    <button className="text-btn" onClick={() => setSelection(new Set())}>清除</button>
                  </div>
                ) : null}

                <div className="rows">
                  {detail.tracks.map((track, index) => (
                    <div className="row" key={track.id} style={{ gridTemplateColumns: "24px 38px minmax(0,1fr) 70px 72px" }}>
                      <button className={`check ${selection.has(track.id) ? "on" : ""}`} onClick={() => toggle(track.id)} aria-label="选择曲目">
                        {selection.has(track.id) ? <Check size={11} weight="bold" /> : null}
                      </button>
                      <div className="qcover"><Cover url={track.coverUrl} title={track.name} artist={track.artists.join("/")} /></div>
                      <div className="main">
                        <div className="name">{track.name}</div>
                        <div className="sub">{track.artists.join(" / ")}{track.album ? ` · ${track.album}` : ""}</div>
                      </div>
                      <div className="cell">{fmtDuration(track.durationMs)}</div>
                      <div className="acts">
                        <button
                          className="icon-btn"
                          title="试听"
                          onClick={() =>
                            void startPreview({ trackId: track.id, name: track.name, artists: track.artists, coverUrl: track.coverUrl })
                          }
                        >
                          <Play size={15} />
                        </button>
                        <button className="icon-btn" title="下载这首" onClick={() => void enqueue([track.id])}>
                          <DownloadSimple size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {!detail.tracks.length ? (
                  <EmptyState icon={MusicNotes} title="这个歌单是空的" description="换一个歌单，或去搜索里直接下载单曲。" />
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={MusicNotes}
          title="没有找到歌单"
          description="账号里可能还没有歌单，或接口需要重新登录。刷新一次试试。"
          actions={<button className="btn btn-ghost" onClick={() => void loadList()}>重新加载</button>}
        />
      )}
    </>
  );
}
