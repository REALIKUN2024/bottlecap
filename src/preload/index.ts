import { contextBridge, ipcRenderer } from "electron";
import { EVT, IPC } from "../shared/types";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; stage?: string; detail?: string } };

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as Envelope<T>;
  if (result && result.ok === false) {
    const error = new Error(result.error.message || "操作失败");
    (error as Error & { code?: string; stage?: string }).code = result.error.code;
    (error as Error & { code?: string; stage?: string }).stage = result.error.stage;
    throw error;
  }
  return (result as { ok: true; data: T }).data;
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  auth: {
    status: () => invoke(IPC.authStatus),
    connectLocal: () => invoke(IPC.authLocal),
    startQr: () => invoke(IPC.authQrStart),
    pollQr: (token: string) => invoke(IPC.authQrPoll, { token }),
    logout: () => invoke(IPC.authLogout),
    onAuth: (callback: (state: unknown) => void) => subscribe(EVT.auth, callback),
  },
  tracks: {
    resolve: (input: string) => invoke(IPC.trackResolve, { input }),
    search: (query: string, cursor = "0") => invoke(IPC.search, { query, cursor }),
  },
  playlists: {
    list: () => invoke(IPC.playlistsList),
    detail: (id: string) => invoke(IPC.playlistsDetail, { id }),
  },
  preview: {
    start: (trackId: string) => invoke(IPC.previewStart, { trackId }),
    dispose: (trackId: string) => invoke(IPC.previewDispose, { trackId }),
    onProgress: (callback: (progress: unknown) => void) => subscribe(EVT.preview, callback),
  },
  downloads: {
    enqueue: (tracks: unknown[], format?: string) => invoke(IPC.downloadsEnqueue, { tracks, format }),
    pause: (id: string) => invoke(IPC.downloadsPause, { id }),
    resume: (id: string) => invoke(IPC.downloadsResume, { id }),
    cancel: (id: string) => invoke(IPC.downloadsCancel, { id }),
    retry: (id: string) => invoke(IPC.downloadsRetry, { id }),
    remove: (id: string) => invoke(IPC.downloadsRemove, { id }),
    reveal: (path: string) => invoke(IPC.downloadsReveal, { path }),
    snapshot: () => invoke(IPC.queueSnapshot),
    clearFinished: () => invoke(IPC.queueClearFinished),
    onUpdate: (callback: (snapshot: unknown) => void) => subscribe(EVT.queue, callback),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch: unknown) => invoke(IPC.settingsUpdate, patch),
    chooseDir: () => invoke(IPC.settingsChooseDir),
  },
  history: {
    list: () => invoke(IPC.historyList),
    remove: (id: string) => invoke(IPC.historyRemove, { id }),
    clear: () => invoke(IPC.historyClear),
    reveal: (path: string) => invoke(IPC.historyReveal, { path }),
  },
  app: {
    probe: () => invoke(IPC.probe),
    openPath: (path: string) => invoke(IPC.openPath, { path }),
    minimize: () => invoke(IPC.windowMin),
    maximize: () => invoke(IPC.windowMax),
    close: () => invoke(IPC.windowClose),
  },
};

contextBridge.exposeInMainWorld("bottlecap", api);

export type BottlecapApi = typeof api;
