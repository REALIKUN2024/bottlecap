import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  CaretRight,
  DownloadSimple,
  FolderOpen,
  LinkSimple,
  Pause,
  Play,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useApp } from "../store";
import {
  fmtBitrate,
  fmtBytes,
  fmtDuration,
  fmtSpeed,
  isActive,
  summaryOf,
  STAGE_TEXT,
} from "../lib/format";
import type { Task, TrackDetail, Variant } from "../../../shared/types";
import { Badge, Cover, EmptyState, Pipeline, ProgressBar, Spinner } from "../components/ui";

function bestVariant(detail: TrackDetail | null): Variant | undefined {
  if (!detail) return undefined;
  return detail.variants.find((variant) => variant.codec === "flac") || detail.variants[0];
}

function TaskActions({ task }: { task: Task }) {
  const pause = () => void api.downloads.pause(task.id);
  const resume = () => void api.downloads.resume(task.id);
  const cancel = () => void api.downloads.cancel(task.id);
  const reveal = () => void api.downloads.reveal(task.outputPath || "");
  const retry = () => void api.downloads.retry(task.id);
  const remove = () => void api.downloads.remove(task.id);

  if (task.stage === "done") {
    return (
      <>
        <button className="icon-btn" title="在文件夹中显示" onClick={reveal}><FolderOpen size={15} /></button>
        <button className="icon-btn" title="移除" onClick={remove}><X size={15} /></button>
      </>
    );
  }
  if (task.stage === "failed") {
    return (
      <>
        <button className="icon-btn" title="重试" onClick={retry}><ArrowClockwise size={15} /></button>
        <button className="icon-btn" title="移除" onClick={remove}><X size={15} /></button>
      </>
    );
  }
  if (task.stage === "paused" || task.stage === "canceled") {
    return (
      <>
        <button className="icon-btn" title="继续" onClick={resume}><Play size={15} /></button>
        <button className="icon-btn" title="移除" onClick={remove}><X size={15} /></button>
      </>
    );
  }
  if (task.stage === "queued") {
    return (
      <>
        <button className="icon-btn" title="暂停" onClick={pause}><Pause size={15} /></button>
        <button className="icon-btn" title="移除" onClick={remove}><X size={15} /></button>
      </>
    );
  }
  return (
    <>
      <button className="icon-btn" title="暂停" onClick={pause}><Pause size={15} /></button>
      <button className="icon-btn" title="取消" onClick={cancel}><X size={15} /></button>
    </>
  );
}

function EmptySleeve() {
  return (
    <svg viewBox="0 0 300 300" role="img" aria-label="等待解析的唱片封套">
      <rect width="300" height="300" fill="#E7E0D1" />
      <circle cx="150" cy="128" r="88" fill="none" stroke="#2F5D4E" strokeWidth="1.1" opacity=".5" />
      <circle cx="150" cy="128" r="62" fill="none" stroke="#2F5D4E" strokeWidth="1" opacity=".38" />
      <circle cx="150" cy="128" r="36" fill="none" stroke="#2F5D4E" strokeWidth="1" opacity=".3" />
      <circle cx="150" cy="128" r="5" fill="#2F5D4E" opacity=".7" />
      <path d="M136 82h28l-4 22a10 10 0 0 1-20 0l-4-22Z" fill="none" stroke="#1B1A17" strokeWidth="2" />
      <path d="M150 104v18" stroke="#1B1A17" strokeWidth="2" strokeLinecap="round" />
      <text x="28" y="232" fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#4E4A43" letterSpacing="2">BOTTLE CAP / SIDE A</text>
      <text x="28" y="262" fontFamily="Noto Serif SC, Songti SC, serif" fontSize="24" fontWeight="600" fill="#1B1A17" letterSpacing="2">等待解析</text>
      <text x="272" y="262" textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#4A463F">FLAC · 44.1kHz</text>
    </svg>
  );
}

export default function DownloadPage() {
  const auth = useApp((state) => state.auth);
  const settings = useApp((state) => state.settings);
  const tasks = useApp((state) => state.tasks);
  const history = useApp((state) => state.history);
  const pushToast = useApp((state) => state.pushToast);
  const setLoginOpen = useApp((state) => state.setLoginOpen);
  const setPage = useApp((state) => state.setPage);
  const startPreview = useApp((state) => state.startPreview);
  const preview = useApp((state) => state.preview);

  const [input, setInput] = useState("");
  const [detail, setDetail] = useState<TrackDetail | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  const active = tasks.find((task) => isActive(task));
  const lastDone = [...tasks].reverse().find((task) => task.stage === "done");
  const current = active || lastDone;
  const failed = [...tasks].reverse().find((task) => task.stage === "failed");
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return history.filter((entry) => {
      if (seen.has(entry.trackId)) return false;
      seen.add(entry.trackId);
      return true;
    }).slice(0, 3);
  }, [history]);
  const variant = bestVariant(detail);

  const queueCounts = useMemo(
    () => ({
      active: tasks.filter((task) => isActive(task)).length,
      done: tasks.filter((task) => task.stage === "done").length,
    }),
    [tasks],
  );

  const resolve = async (text = input) => {
    const value = text.trim();
    if (!value) return;
    if (!auth?.connected) {
      setLoginOpen(true);
      return;
    }
    setResolving(true);
    setError("");
    try {
      const result = await api.tracks.resolve(value);
      setDetail(result.detail);
      setInput(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : "解析失败";
      setError(message);
      pushToast(message, "error");
    } finally {
      setResolving(false);
    }
  };

  const enqueue = async () => {
    if (!detail) return;
    try {
      await api.downloads.enqueue([summaryOf(detail)], settings?.format);
      pushToast(`已加入下载：${detail.name}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "加入队列失败", "error");
    }
  };

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Qi Shui · 本地唱片</p>
          <h1>
            把汽水里的歌，
            <br />
            装进唱片内页。
          </h1>
          <p className="lede">
            粘贴分享链接或 19 位 track_id。签名由本机客户端生成，<em>FLAC 直接落盘</em>，封面、歌手与歌词一起写进文件。
          </p>

          <form
            className="paste"
            onSubmit={(event) => {
              event.preventDefault();
              void resolve();
            }}
          >
            <label className="paste-field">
              <LinkSimple size={16} />
              <span className="sr">曲目链接或 ID</span>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="粘贴分享链接，或输入 19 位 track_id"
                spellCheck={false}
                autoFocus
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={resolving || !input.trim()}>
              {resolving ? <Spinner /> : <>解析 <CaretRight size={15} /></>}
            </button>
          </form>

          {error ? (
            <div className="error-inline">
              <WarningCircle size={16} />
              <div className="grow"><b>没能解析。</b>{error}</div>
            </div>
          ) : null}

          <div className="quick">
            <span className="quick-label">最近</span>
            {recent.length ? (
              recent.map((entry) => (
                <button key={entry.id} className="chip" onClick={() => void resolve(entry.trackId)}>
                  {entry.name} <span className="mono">{entry.trackId.slice(-4)}</span>
                </button>
              ))
            ) : (
              <span className="tiny muted">还没有下载记录，从上面粘一条链接开始。</span>
            )}
          </div>
        </div>

        <div className="hero-art">
          <div className="sleeve">
            <div className="cover">
              {detail ? <Cover url={detail.coverUrl} title={detail.name} artist={detail.artists.join("/")} /> : <EmptySleeve />}
            </div>
            <div className="sleeve-caption">
              <b>{detail?.name || "等待解析"}</b>
              <span>{detail ? `${variant ? fmtBytes(variant.size || 0) : "—"} · ${fmtDuration(detail.durationMs)}` : "FLAC · 44.1 kHz"}</span>
            </div>
          </div>

          <div className="params" aria-label="音频参数">
            <div className="param"><span>编码</span><b>{variant ? variant.codec.toUpperCase() : "—"}</b></div>
            <div className="param"><span>码率</span><b>{fmtBitrate(variant?.bitrate)}</b></div>
            <div className="param"><span>采样</span><b>{variant?.sampleRate ? `${(variant.sampleRate / 1000).toFixed(1)}k` : "—"}</b></div>
            <div className="param"><span>时长</span><b>{detail ? `${(detail.durationMs / 1000).toFixed(2)}s` : "—"}</b></div>
          </div>

          {detail ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void enqueue()}>
                <DownloadSimple size={16} /> 加入下载
              </button>
              <button
                className="btn btn-ghost"
                onClick={() =>
                  void startPreview({ trackId: detail.id, name: detail.name, artists: detail.artists, coverUrl: detail.coverUrl })
                }
                disabled={preview?.trackId === detail.id && preview.status === "loading"}
              >
                {preview?.trackId === detail.id && preview.status === "loading" ? <Spinner /> : <><Play size={15} /> 试听</>}
              </button>
            </div>
          ) : null}
          {detail?.preview ? (
            <div className="error-inline" style={{ marginTop: 10 }}>
              <WarningCircle size={15} />
              <div className="grow">这是试听片段（{((detail.streamDurationMs || 0) / 1000).toFixed(1)}s / {(detail.durationMs / 1000).toFixed(1)}s），下载会失败。</div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="section" aria-labelledby="currentTitle">
        <div className="section-head">
          <h2 id="currentTitle">{active ? "正在写入" : current ? "最近完成" : "正在写入"}</h2>
          <span className="count">{String(queueCounts.active).padStart(2, "0")} / {String(tasks.length).padStart(2, "0")}</span>
          <div className="spacer" />
          <button className="text-btn" onClick={() => void api.downloads.clearFinished()}>清空已完成</button>
        </div>

        {current ? (
          <div className="current-card">
            <div className="task">
              <div className="mini-cover"><Cover url={current.coverUrl} title={current.name} artist={current.artists.join("/")} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="task-title">
                  {current.name}
                  <Badge>{current.codec ? `${current.codec.toUpperCase()} · ${fmtBitrate(current.bitrate)}` : STAGE_TEXT[current.stage]}</Badge>
                </div>
                <div className="task-sub">
                  <span>{current.artists.join(" / ")}</span>
                  {current.album ? <><span className="sep" /><span>{current.album}</span></> : null}
                  <span className="sep" /><span className="mono">{fmtDuration(current.durationMs)}</span>
                  {current.bytesTotal ? <><span className="sep" /><span className="mono">{fmtBytes(current.bytesTotal)}</span></> : null}
                </div>
                <Pipeline stage={current.stage} />
              </div>
              <div className="task-side">
                <div className="pct mono">{Math.round(current.progress)}<small>%</small></div>
                <div className="meta mono">
                  {current.stage === "downloading" ? `${fmtSpeed(current.speedBps)} · ${fmtBytes(current.bytesDone)}` : STAGE_TEXT[current.stage]}
                </div>
                <div className="task-actions"><TaskActions task={current} /></div>
              </div>
            </div>
            <ProgressBar value={current.progress} ariaLabel={`${current.name} 进度`} />
          </div>
        ) : (
          <EmptyState
            icon={DownloadSimple}
            title="现在没有在写的唱片"
            description="粘一条分享链接，或去歌单里挑几首。下载会按设置里的格式与并发执行。"
            actions={
              <>
                <button className="btn btn-ghost" onClick={() => (auth?.connected ? setPage("playlists") : setLoginOpen(true))}>
                  {auth?.connected ? "去歌单挑歌" : "先登录账号"}
                </button>
                <button className="btn btn-ghost" onClick={() => void api.app.openPath(settings?.outputDir || "")}>
                  <FolderOpen size={15} /> 打开输出目录
                </button>
              </>
            }
          />
        )}

        {failed ? (
          <div className="notice">
            <WarningCircle size={15} />
            <span><b>刚才有一首没下成。</b>{failed.name}：{failed.error?.message || "未知错误"}</span>
            <button className="text-btn" onClick={() => void api.downloads.retry(failed.id)}>重试</button>
          </div>
        ) : null}
      </section>

      <section className="section" aria-labelledby="queueTitle">
        <div className="section-head">
          <h2 id="queueTitle">队列</h2>
          <span className="count">{String(tasks.length).padStart(2, "0")}</span>
          <div className="spacer" />
          <span className="tiny muted">并发 {settings?.concurrency ?? 2}</span>
        </div>

        {tasks.length ? (
          <div className="queue">
            <div className="qhead" aria-hidden="true">
              <span style={{ textAlign: "center" }}>#</span>
              <span>曲目</span>
              <span>规格</span>
              <span>阶段</span>
              <span style={{ textAlign: "right" }}>操作</span>
            </div>
            {tasks.map((task, index) => (
              <div className="qrow" key={task.id}>
                <div className="idx">{String(index + 1).padStart(2, "0")}</div>
                <div className="qtitle">
                  <div className="qcover"><Cover url={task.coverUrl} title={task.name} artist={task.artists.join("/")} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="qname">{task.name}</div>
                    <div className="qartist">{task.artists.join(" / ")}{task.album ? ` · ${task.album}` : ""}</div>
                  </div>
                </div>
                <div className="qspec">
                  {task.codec ? `${task.codec.toUpperCase()} · ${fmtBitrate(task.bitrate)}` : task.format.toUpperCase()}
                  <small>{task.stage === "downloading" ? `${fmtSpeed(task.speedBps)} · ${fmtBytes(task.bytesDone)}` : fmtDuration(task.durationMs)}</small>
                </div>
                <div className={`qstate ${task.stage === "done" ? "done" : task.stage === "queued" ? "queued" : ""}`}>
                  <span className="dot" />
                  {STAGE_TEXT[task.stage]} <span className="p">{task.stage === "failed" ? task.error?.code : `${Math.round(task.progress)}%`}</span>
                </div>
                <div className="qactions"><TaskActions task={task} /></div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={DownloadSimple}
            title="队列还是空的"
            description="解析一首歌后点「加入下载」，或从歌单/搜索里批量加入。"
            actions={<button className="btn btn-ghost" onClick={() => void api.app.openPath(settings?.outputDir || "")}>打开输出目录</button>}
          />
        )}
      </section>
    </>
  );
}
