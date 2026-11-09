import { useMemo } from "react";
import { ClockCounterClockwise, FolderOpen, Trash } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useApp } from "../store";
import { fmtBytes, fmtDate, fmtDay, fmtDuration, formatLabel } from "../lib/format";
import { Cover, EmptyState } from "../components/ui";

export default function HistoryPage() {
  const history = useApp((state) => state.history);
  const setHistory = useApp((state) => state.setHistory);
  const setPage = useApp((state) => state.setPage);
  const pushToast = useApp((state) => state.pushToast);

  const groups = useMemo(() => {
    const map = new Map<string, typeof history>();
    for (const entry of history) {
      const key = fmtDay(entry.finishedAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return [...map.entries()];
  }, [history]);

  const stats = useMemo(() => {
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = history.filter((entry) => entry.finishedAt >= week);
    return {
      count: recent.length,
      size: recent.reduce((sum, entry) => sum + entry.size, 0),
    };
  }, [history]);

  const remove = async (id: string) => {
    try {
      setHistory(await api.history.remove(id));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "删除记录失败", "error");
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>历史</h1>
          <p>下载过的唱片记录。移除记录不会删除磁盘上的文件。</p>
        </div>
        <div className="spacer" />
        <div className="actions">
          <span className="tiny muted">本周 <span className="mono">{stats.count}</span> 首 · {fmtBytes(stats.size)}</span>
          {history.length ? (
            <button
              className="text-btn"
              onClick={async () => {
                setHistory(await api.history.clear());
                pushToast("已清空历史记录");
              }}
            >
              清空记录
            </button>
          ) : null}
        </div>
      </div>

      {history.length ? (
        <div>
          {groups.map(([day, entries]) => (
            <section key={day} style={{ marginBottom: 30 }}>
              <div className="section-head" style={{ marginBottom: 8 }}>
                <h2 style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>{day}</h2>
                <span className="count">{entries.length}</span>
              </div>
              <div className="rows">
                {entries.map((entry) => (
                  <div className="row" key={entry.id} style={{ gridTemplateColumns: "38px minmax(0,1fr) 120px 96px 78px" }}>
                    <div className="qcover"><Cover url={entry.coverUrl} title={entry.name} artist={entry.artists.join("/")} /></div>
                    <div className="main">
                      <div className="name">{entry.name}</div>
                      <div className="sub">{entry.artists.join(" / ")}{entry.album ? ` · ${entry.album}` : ""}</div>
                    </div>
                    <div className="cell">{formatLabel(entry.format)}<small>{fmtBytes(entry.size)}</small></div>
                    <div className="cell">{fmtDate(entry.finishedAt)}<small>{fmtDuration(entry.durationMs)}</small></div>
                    <div className="acts">
                      <button className="icon-btn" title="在文件夹中显示" onClick={() => void api.history.reveal(entry.path)}><FolderOpen size={15} /></button>
                      <button className="icon-btn" title="移除记录" onClick={() => void remove(entry.id)}><Trash size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ClockCounterClockwise}
          title="还没有下载记录"
          description="完成第一首之后，这里会按日期列出文件、格式与大小。"
          actions={<button className="btn btn-ghost" onClick={() => setPage("download")}>去下载</button>}
        />
      )}
    </>
  );
}
