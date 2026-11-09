import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { EVT, IPC } from "../shared/types";
import type { Format, Settings, TrackSummary } from "../shared/types";
import { AppError } from "./errors";
import { findClientDir, localCookiesPath, deviceV1Path, type ClientPaths } from "./paths";
import { Store } from "./store";
import { resolveIdentity, type DeviceIdentity } from "./qishui/identity";
import { AuthManager } from "./qishui/auth";
import { QishuiClient } from "./qishui/client";
import { TrackService } from "./qishui/track";
import { PlaylistService } from "./qishui/playlists";
import { QueueManager } from "./queue";
import { resolveFfmpeg } from "./media/ffmpeg";
import { PreviewManager } from "./preview";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "bottlecap-preview",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let store: Store;
let auth: AuthManager;
let queue: QueueManager;
let previews: PreviewManager;
let identity: DeviceIdentity;
let clientPaths: ClientPaths | null = null;

function currentSettings(): Settings {
  return store.getSettings();
}

function refreshClient(): ClientPaths | null {
  clientPaths = findClientDir(currentSettings().clientDir || undefined);
  return clientPaths;
}

function makeClient(session: string): QishuiClient {
  const client = clientPaths || refreshClient();
  if (!client) {
    throw new AppError("CLIENT_MISSING", "没找到汽水音乐客户端，请先安装并登录客户端，或在设置里指定目录", "resolving");
  }
  return new QishuiClient(client, identity, session);
}

function registerIpc(): void {
  const handle = (channel: string, fn: (payload: any) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, data: await fn(payload) };
      } catch (error) {
        if (error instanceof AppError) {
          return { ok: false, error: { code: error.code, message: error.message, stage: error.stage, detail: error.detail } };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: { code: "UNKNOWN", message } };
      }
    });
  };

  handle(IPC.authStatus, () => auth.getState());
  handle(IPC.authLocal, () => auth.connectLocal());
  handle(IPC.authQrStart, () => auth.startQr());
  handle(IPC.authQrPoll, (payload: { token: string }) => auth.pollQr(payload.token));
  handle(IPC.authLogout, () => {
    auth.logout();
    return auth.getState();
  });

  handle(IPC.trackResolve, async (payload: { input: string }) => {
    const session = auth.requireSession();
    const client = makeClient(session);
    const service = new TrackService(client);
    const trackId = await service.resolveInput(payload.input);
    const detail = await service.fetchDetail(trackId);
    return { trackId, detail };
  });

  handle(IPC.search, async (payload: { query: string; cursor?: string }) => {
    const session = auth.requireSession();
    const client = makeClient(session);
    return new TrackService(client).search(payload.query, payload.cursor || "0");
  });

  handle(IPC.playlistsList, async () => {
    const session = auth.requireSession();
    const client = makeClient(session);
    const service = new PlaylistService(client);
    return service.listMine(auth.getState().uid);
  });

  handle(IPC.playlistsDetail, async (payload: { id: string }) => {
    const session = auth.requireSession();
    const client = makeClient(session);
    return new PlaylistService(client).detail(payload.id);
  });

  handle(IPC.previewStart, (payload: { trackId: string }) => previews.start(payload.trackId));
  handle(IPC.previewDispose, (payload: { trackId: string }) => previews.dispose(payload.trackId));
  handle(IPC.downloadsEnqueue, (payload: { tracks: TrackSummary[]; format?: Format }) => queue.enqueue(payload.tracks || [], payload.format));
  handle(IPC.downloadsPause, (payload: { id: string }) => queue.pause(payload.id));
  handle(IPC.downloadsResume, (payload: { id: string }) => queue.resume(payload.id));
  handle(IPC.downloadsCancel, (payload: { id: string }) => queue.cancel(payload.id));
  handle(IPC.downloadsRetry, (payload: { id: string }) => queue.retry(payload.id));
  handle(IPC.downloadsRemove, (payload: { id: string }) => queue.remove(payload.id));
  handle(IPC.downloadsReveal, (payload: { path: string }) => {
    if (payload.path && fs.existsSync(payload.path)) shell.showItemInFolder(payload.path);
  });
  handle(IPC.queueSnapshot, () => queue.snapshot());
  handle(IPC.queueClearFinished, () => queue.clearFinished());

  handle(IPC.settingsGet, () => currentSettings());
  handle(IPC.settingsUpdate, (payload: Partial<Settings>) => {
    const settings = store.updateSettings(payload);
    if (payload.clientDir !== undefined) refreshClient();
    queue.notifySettingsChanged();
    return settings;
  });
  handle(IPC.settingsChooseDir, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择保存目录",
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });

  handle(IPC.historyList, () => store.getHistory());
  handle(IPC.historyRemove, (payload: { id: string }) => {
    store.removeHistory(payload.id);
    return store.getHistory();
  });
  handle(IPC.historyClear, () => {
    store.clearHistory();
    return store.getHistory();
  });
  handle(IPC.historyReveal, (payload: { path: string }) => {
    if (payload.path && fs.existsSync(payload.path)) shell.showItemInFolder(payload.path);
  });

  handle(IPC.probe, () => {
    const client = refreshClient();
    return {
      found: Boolean(client),
      dir: client?.dir,
      version: client?.version,
      hasBdms: Boolean(client && fs.existsSync(client.bdms)),
      hasDevice: fs.existsSync(deviceV1Path()),
      hasCookie: fs.existsSync(localCookiesPath()),
      ffmpeg: Boolean(resolveFfmpeg(currentSettings().ffmpegPath || undefined)),
      node: process.versions.node,
      electron: process.versions.electron,
    };
  });

  handle(IPC.openPath, async (payload: { path: string }) => {
    if (payload.path) await shell.openPath(payload.path);
  });

  handle(IPC.windowMin, () => mainWindow?.minimize());
  handle(IPC.windowMax, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  handle(IPC.windowClose, () => mainWindow?.close());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: "#F6F2E9",
    title: "开瓶器 · 汽水音乐下载器",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    const query: Record<string, string> = {};
    if (process.env.BOTTLECAP_SKIP_LOGIN) query.skipLogin = "1";
    if (process.env.BOTTLECAP_CAPTURE_PAGE) query.page = process.env.BOTTLECAP_CAPTURE_PAGE;
    if (process.env.BOTTLECAP_CAPTURE_LOGIN) query.login = "1";
    if (process.env.BOTTLECAP_CAPTURE_PREVIEW) query.preview = process.env.BOTTLECAP_CAPTURE_PREVIEW;
    void mainWindow.loadFile(
      path.join(__dirname, "../renderer/index.html"),
      Object.keys(query).length ? { query } : undefined,
    );
  }

  if (process.env.BOTTLECAP_CAPTURE) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow!.webContents.capturePage();
          fs.writeFileSync(process.env.BOTTLECAP_CAPTURE!, image.toPNG());
        } catch (error) {
          console.error("capture failed", error);
        }
        app.quit();
      }, Number(process.env.BOTTLECAP_CAPTURE_DELAY || 4200));
    });
  }
}

async function runSelfTest(): Promise<void> {
  try {
    await auth.restore();
    const state = auth.getState();
    if (!state.connected) throw new Error("未登录：" + (state.message || ""));
    const client = makeClient(auth.requireSession());
    const mode = process.env.BOTTLECAP_SELFTEST;

    if (mode === "preview") {
      const id = process.env.BOTTLECAP_SELFTEST_TRACK || "7079108541549643812";
      const source = await previews.start(id);
      console.log("SELFTEST preview", JSON.stringify(source));
      try {
        const response = await net.fetch(source.url, { headers: { range: "bytes=0-1023" } });
        const bytes = (await response.arrayBuffer()).byteLength;
        console.log("SELFTEST preview-fetch", JSON.stringify({ status: response.status, bytes, range: response.headers.get("content-range"), type: response.headers.get("content-type") }));
      } catch (error) {
        console.log("SELFTEST preview-fetch-error", error instanceof Error ? error.message : String(error));
      }
      setTimeout(() => app.exit(0), 400);
      return;
    }

    if (mode === "playlists") {
      const service = new PlaylistService(client);
      const list = await service.listMine(state.uid);
      console.log("SELFTEST playlists", JSON.stringify(list.slice(0, 12)));
      if (list[0]) {
        const detail = await service.detail(list[0].id);
        console.log("SELFTEST playlist-detail", JSON.stringify({ title: detail.title, count: detail.tracks.length, first: detail.tracks.slice(0, 3) }));
      }
      app.exit(0);
      return;
    }

    if (mode === "search") {
      const result = await new TrackService(client).search(process.env.BOTTLECAP_SELFTEST_Q || "陈粒");
      console.log("SELFTEST search", JSON.stringify({ count: result.tracks.length, hasMore: result.hasMore, first: result.tracks.slice(0, 5) }));
      app.exit(0);
      return;
    }

    const detail = await new TrackService(client).fetchDetail(mode!);
    console.log(
      "SELFTEST detail",
      JSON.stringify({ name: detail.name, artists: detail.artists, preview: detail.preview, durationMs: detail.durationMs, variants: detail.variants.map((v) => [v.codec, v.bitrate, v.size]) }),
    );
    const format = (process.env.BOTTLECAP_SELFTEST_FORMAT as Format) || "original";
    queue.enqueue([detail], format);
    const timer = setInterval(() => {
      const task = queue.snapshot().tasks[0];
      if (!task) return;
      if (task.stage === "done" || task.stage === "failed") {
        clearInterval(timer);
        let size = 0;
        try {
          if (task.outputPath) size = fs.statSync(task.outputPath).size;
        } catch {
          /* ignore */
        }
        console.log("SELFTEST result", JSON.stringify({ stage: task.stage, path: task.outputPath, size, error: task.error }));
        setTimeout(() => app.exit(task.stage === "done" ? 0 : 1), 400);
      }
    }, 500);
  } catch (error) {
    console.log("SELFTEST error", error instanceof Error ? error.message : String(error));
    setTimeout(() => app.exit(1), 300);
  }
}

async function bootstrap(): Promise<void> {
  store = new Store();
  refreshClient();
  identity = resolveIdentity(store.dir);
  auth = new AuthManager(store, identity, clientPaths?.version || "未检测到客户端");
  queue = new QueueManager({
    store,
    auth,
    resolveClient: () => clientPaths || refreshClient(),
    identity,
  });
  previews = new PreviewManager({
    store,
    auth,
    resolveClient: () => clientPaths || refreshClient(),
    identity,
  });
  protocol.handle("bottlecap-preview", (request) => previews.serve(request));
  previews.on("progress", (progress) => {
    mainWindow?.webContents.send(EVT.preview, progress);
  });

  auth.on("auth", (state) => {
    mainWindow?.webContents.send(EVT.auth, state);
  });
  queue.on("update", (snapshot) => {
    mainWindow?.webContents.send(EVT.queue, snapshot);
  });

  registerIpc();
  if (process.env.BOTTLECAP_SELFTEST) {
    void runSelfTest();
    return;
  }
  createWindow();
  void auth.restore().then(async () => {
    if (!process.env.BOTTLECAP_CAPTURE_TASK) return;
    try {
      const client = makeClient(auth.requireSession());
      const detail = await new TrackService(client).fetchDetail(process.env.BOTTLECAP_CAPTURE_TASK);
      queue.enqueue([detail], (process.env.BOTTLECAP_CAPTURE_FORMAT as Format) || "original");
    } catch (error) {
      console.error("capture task failed", error);
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.bottlecap.downloader");
    void bootstrap();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on("before-quit", () => {
    previews?.cleanupAll();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
