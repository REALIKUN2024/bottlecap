import { useState } from "react";
import { DownloadSimple, LinkSimple, MagnifyingGlass, Play, WarningCircle } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useApp } from "../store";
import { fmtDuration, formatLabel } from "../lib/format";
import type { TrackSummary } from "../../../shared/types";
import { Cover, EmptyState, Spinner } from "../components/ui";

export default function SearchPage() {
  const auth = useApp((state) => state.auth);
  const settings = useApp((state) => state.settings);
  const pushToast = useApp((state) => state.pushToast);
  const setLoginOpen = useApp((state) => state.setLoginOpen);
  const startPreview = useApp((state) => state.startPreview);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrackSummary[]>([]);
  const [cursor, setCursor] = useState("0");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const runSearch = async (nextCursor = "0", append = false) => {
    if (!auth?.connected) {
      setLoginOpen(true);
      return;
    }
    const value = query.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.tracks.search(value, nextCursor);
      setResults((current) => (append ? [...current, ...result.tracks.filter((track) => !current.some((item) => item.id === track.id))] : result.tracks));
      setCursor(result.cursor);
      setHasMore(result.hasMore);
      setSearched(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "搜索失败";
      setError(message);
      setResults(append ? results : []);
      pushToast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  const enqueue = async (track: TrackSummary) => {
    try {
      await api.downloads.enqueue([track], settings?.format);
      pushToast(`已加入下载：${track.name}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "加入队列失败", "error");
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>搜索</h1>
          <p>按歌名、歌手或专辑搜索汽水曲库；结果按当前格式加入队列。</p>
        </div>
      </div>

      <form
        className="searchbar"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch("0", false);
        }}
      >
        <label className="paste-field w-full">
          <LinkSimple size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索歌曲、歌手、专辑"
            spellCheck={false}
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? <Spinner /> : <><MagnifyingGlass size={15} /> 搜索</>}
        </button>
      </form>

      {error ? (
        <div className="error-inline">
          <WarningCircle size={16} />
          <div className="grow"><b>搜索失败。</b>{error}</div>
          <button className="text-btn" onClick={() => void runSearch("0", false)}>重试</button>
        </div>
      ) : null}

      {loading && !results.length ? (
        <div className="loading-block">{Array.from({ length: 7 }).map((_, index) => <div className="skeleton" key={index} />)}</div>
      ) : results.length ? (
        <>
          <div className="results-meta">
            <span className="mono">{results.length}</span> 条结果
            <span className="grow" />
            <span>{formatLabel(settings?.format || "original")} 输出</span>
          </div>
          <div className="rows">
            {results.map((track, index) => (
              <div className="row" key={track.id} style={{ gridTemplateColumns: "28px 40px minmax(0,1fr) 70px 76px" }}>
                <div className="num">{String(index + 1).padStart(2, "0")}</div>
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
                    <Play size={16} />
                  </button>
                  <button className="icon-btn" title="下载这首" onClick={() => void enqueue(track)}>
                    <DownloadSimple size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {hasMore ? (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => void runSearch(cursor, true)} disabled={loading}>
                {loading ? <Spinner label="加载" /> : "加载更多"}
              </button>
            </div>
          ) : null}
        </>
      ) : searched ? (
        <EmptyState
          icon={MagnifyingGlass}
          title="没有搜到"
          description="换一个关键词试试；也可以直接粘贴分享链接，在下载页解析。"
        />
      ) : (
        <EmptyState
          icon={MagnifyingGlass}
          title="搜一首歌"
          description="输入歌名或歌手，回车开始。搜索结果会显示可用音质，点右侧按钮加入下载。"
        />
      )}
    </>
  );
}
