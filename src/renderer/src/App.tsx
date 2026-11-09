import { useEffect, useRef } from "react";
import {
  ClockCounterClockwise,
  DownloadSimple,
  GearSix,
  MagnifyingGlass,
  Minus,
  MusicNotes,
  Square,
  X,
} from "@phosphor-icons/react";
import { api } from "./lib/api";
import { useApp, type Page } from "./store";
import { isActive } from "./lib/format";
import DownloadPage from "./pages/Download";
import PlaylistsPage from "./pages/Playlists";
import SearchPage from "./pages/Search";
import HistoryPage from "./pages/History";
import SettingsPage from "./pages/Settings";
import SettingsPanel from "./components/SettingsPanel";
import LoginModal from "./components/LoginModal";
import PreviewBar from "./components/PreviewBar";
import { Toasts } from "./components/ui";

const NAV: { page: Page; label: string; icon: typeof DownloadSimple }[] = [
  { page: "download", label: "下载", icon: DownloadSimple },
  { page: "playlists", label: "歌单", icon: MusicNotes },
  { page: "search", label: "搜索", icon: MagnifyingGlass },
  { page: "history", label: "历史", icon: ClockCounterClockwise },
];

const TITLES: Record<Page, string> = {
  download: "下载",
  playlists: "歌单",
  search: "搜索",
  history: "历史",
  settings: "设置",
};

export default function App() {
  const page = useApp((state) => state.page);
  const setPage = useApp((state) => state.setPage);
  const auth = useApp((state) => state.auth);
  const setAuth = useApp((state) => state.setAuth);
  const settings = useApp((state) => state.settings);
  const setSettings = useApp((state) => state.setSettings);
  const tasks = useApp((state) => state.tasks);
  const setQueue = useApp((state) => state.setQueue);
  const history = useApp((state) => state.history);
  const setHistory = useApp((state) => state.setHistory);
  const playlists = useApp((state) => state.playlists);
  const setPlaylists = useApp((state) => state.setPlaylists);
  const loginOpen = useApp((state) => state.loginOpen);
  const setLoginOpen = useApp((state) => state.setLoginOpen);
  const preview = useApp((state) => state.preview);
  const updatePreviewProgress = useApp((state) => state.updatePreviewProgress);
  const startPreview = useApp((state) => state.startPreview);
  const prompted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [authState, nextSettings, snapshot, historyList] = await Promise.all([
          api.auth.status(),
          api.settings.get(),
          api.downloads.snapshot(),
          api.history.list(),
        ]);
        if (cancelled) return;
        setAuth(authState);
        setSettings(nextSettings);
        setQueue(snapshot.tasks, snapshot.concurrency);
        setHistory(historyList);
      } catch (error) {
        console.error(error);
      }
    };
    void load();

    const offAuth = api.auth.onAuth((state) => setAuth(state));
    const offQueue = api.downloads.onUpdate((snapshot) => setQueue(snapshot.tasks, snapshot.concurrency));
    return () => {
      cancelled = true;
      offAuth();
      offQueue();
    };
  }, [setAuth, setHistory, setQueue, setSettings]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("login")) {
      setLoginOpen(true);
      return;
    }
    if (params.has("skipLogin") || !auth || auth.checking || auth.connected || prompted.current) return;
    prompted.current = true;
    setLoginOpen(true);
  }, [auth, setLoginOpen]);

  useEffect(() => api.preview.onProgress(updatePreviewProgress), [updatePreviewProgress]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preview");
    if (!id || !settings || !auth?.connected) return;
    let cancelled = false;
    api.tracks
      .resolve(id)
      .then(({ detail }) => {
        if (cancelled) return;
        void startPreview({ trackId: detail.id, name: detail.name, artists: detail.artists, coverUrl: detail.coverUrl });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings, auth?.connected, startPreview]);

  useEffect(() => {
    if (!auth?.connected) return;
    let cancelled = false;
    api.playlists
      .list()
      .then((list) => {
        if (!cancelled) setPlaylists(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [auth?.connected, setPlaylists]);

  useEffect(() => {
    const done = tasks.filter((task) => task.stage === "done").length;
    if (!done) return;
    const timer = setTimeout(() => {
      api.history.list().then(setHistory).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [tasks, setHistory]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPage("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage]);

  if (!settings) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", background: "var(--paper)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, marginBottom: 8 }}>开瓶器</div>
          <div className="tiny muted">正在打开你的唱片架…</div>
        </div>
      </div>
    );
  }

  const activeCount = tasks.filter((task) => isActive(task)).length;

  return (
    <div className={`app ${page === "download" ? "" : "no-inspector"} ${preview ? "has-preview" : ""}`}>
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 3h8l-1 6a5 5 0 0 1-6 0L8 3Z" /><path d="M12 9v11" /><path d="M8.5 20h7" /></svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">开瓶器</div>
            <div className="brand-sub">Bottlecap</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            const count = item.page === "download" ? activeCount || tasks.length : item.page === "playlists" ? playlists.length : item.page === "history" ? history.length : 0;
            return (
              <a
                key={item.page}
                href="#"
                className={page === item.page ? "active" : ""}
                onClick={(event) => {
                  event.preventDefault();
                  setPage(item.page);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {count ? <span className="nav-count">{count}</span> : null}
              </a>
            );
          })}
        </nav>

        <div className="rail-stats">
          <div className="stat"><b>{history.length}</b><span>已存曲目</span></div>
          <div className="stat"><b>{settings.format === "original" ? "原格式" : settings.format.toUpperCase()}</b><span>当前输出</span></div>
        </div>

        <div className="rail-spacer" />

        <button className="account" onClick={() => (auth?.connected ? setPage("settings") : setLoginOpen(true))} aria-label="账号与设置">
          <div className="avatar">
            {auth?.avatar ? <img src={auth.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : (auth?.nickname || "未").slice(0, 1)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="account-name">{auth?.connected ? auth.nickname || "汽水用户" : "未登录"}</div>
            <div className="account-meta">
              <span className={`dot ${auth?.connected ? "" : "warn"}`} />
              {auth?.connected ? (auth.isVip ? "会员 · 已连接" : "已连接") : "点此登录"}
            </div>
          </div>
          <GearSix size={15} className="account-more" />
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            <span>资料库</span>
            <svg viewBox="0 0 24 24" width={11} height={11}><path d="m9 6 6 6-6 6" stroke="currentColor" fill="none" strokeWidth="1.6" /></svg>
            <b>{TITLES[page]}</b>
          </div>
          <div className="top-actions">
            <button className="conn" onClick={() => (auth?.connected ? setPage("settings") : setLoginOpen(true))}>
              <span className={`dot ${auth?.connected ? "" : "warn"}`} />
              {auth?.connected ? `汽水 ${auth.clientVersion || ""} 已连接` : "未连接 · 点此登录"}
            </button>
            <button className="icon-btn" aria-label="设置" onClick={() => setPage("settings")}>
              <GearSix size={17} />
            </button>
            <div className="win-controls" aria-label="窗口控制">
              <button className="icon-btn" aria-label="最小化" onClick={() => void api.app.minimize()}><Minus size={13} /></button>
              <button className="icon-btn" aria-label="最大化" onClick={() => void api.app.maximize()}><Square size={11} /></button>
              <button className="icon-btn" aria-label="关闭" onClick={() => void api.app.close()}><X size={12} /></button>
            </div>
          </div>
        </header>

        <div className="page">
          {page === "download" ? <DownloadPage /> : null}
          {page === "playlists" ? <PlaylistsPage /> : null}
          {page === "search" ? <SearchPage /> : null}
          {page === "history" ? <HistoryPage /> : null}
          {page === "settings" ? <SettingsPage /> : null}
        </div>
      </main>

      {page === "download" ? <SettingsPanel /> : null}
      <PreviewBar />
      <LoginModal />
      <Toasts />
    </div>
  );
}
