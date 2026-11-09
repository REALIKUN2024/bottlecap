import { create } from "zustand";
import type {
  AuthState,
  ClientProbe,
  HistoryEntry,
  PlaylistSummary,
  PreviewProgress,
  PreviewSource,
  Settings,
  Task,
} from "../../shared/types";
import { api } from "./lib/api";

export type Page = "download" | "playlists" | "search" | "history" | "settings";

export interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "error";
}

export interface PreviewTrack {
  trackId: string;
  name: string;
  artists: string[];
  coverUrl?: string;
}

export interface PreviewView extends PreviewTrack {
  status: "loading" | "ready" | "error";
  stage: string;
  progress: number;
  url?: string;
  durationMs?: number;
  codec?: string;
  previewOnly?: boolean;
  error?: string;
}

interface AppState {
  page: Page;
  setPage: (page: Page) => void;
  auth: AuthState | null;
  setAuth: (auth: AuthState) => void;
  settings: Settings | null;
  setSettings: (settings: Settings) => void;
  tasks: Task[];
  concurrency: number;
  setQueue: (tasks: Task[], concurrency?: number) => void;
  history: HistoryEntry[];
  setHistory: (history: HistoryEntry[]) => void;
  playlists: PlaylistSummary[];
  setPlaylists: (playlists: PlaylistSummary[]) => void;
  probe: ClientProbe | null;
  setProbe: (probe: ClientProbe) => void;
  preview: PreviewView | null;
  startPreview: (track: PreviewTrack) => Promise<void>;
  updatePreviewProgress: (progress: PreviewProgress) => void;
  closePreview: () => void;
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
  toasts: ToastItem[];
  pushToast: (message: string, kind?: "info" | "error") => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

const requestedPage = (() => {
  const value = new URLSearchParams(window.location.search).get("page");
  return value === "download" || value === "playlists" || value === "search" || value === "history" || value === "settings"
    ? (value as Page)
    : "download";
})();

export const useApp = create<AppState>((set) => ({
  page: requestedPage,
  setPage: (page) => set({ page }),
  auth: null,
  setAuth: (auth) => set({ auth }),
  settings: null,
  setSettings: (settings) => set({ settings }),
  tasks: [],
  concurrency: 2,
  setQueue: (tasks, concurrency) => set((state) => ({ tasks, concurrency: concurrency ?? state.concurrency })),
  history: [],
  setHistory: (history) => set({ history }),
  playlists: [],
  setPlaylists: (playlists) => set({ playlists }),
  probe: null,
  setProbe: (probe) => set({ probe }),
  preview: null,
  startPreview: async (track) => {
    const current = useApp.getState().preview;
    if (current?.trackId === track.trackId && (current.status === "loading" || current.status === "ready")) return;
    if (current && current.trackId !== track.trackId) void api.preview.dispose(current.trackId);
    set({ preview: { ...track, status: "loading", stage: "准备试听", progress: 0 } });
    try {
      const source: PreviewSource = await api.preview.start(track.trackId);
      set({
        preview: {
          ...track,
          ...source,
          status: "ready",
          stage: "就绪",
          progress: 100,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "试听准备失败";
      set((state) => ({
        preview: state.preview
          ? { ...state.preview, status: "error", stage: "失败", error: message }
          : null,
      }));
      useApp.getState().pushToast(message, "error");
    }
  },
  updatePreviewProgress: (progress) => {
    const current = useApp.getState().preview;
    if (!current || current.trackId !== progress.trackId) return;
    if (progress.stage === "error") {
      set({ preview: { ...current, status: "error", stage: "失败", error: progress.message } });
      return;
    }
    if (progress.stage === "ready") {
      set({ preview: { ...current, progress: 100, stage: "就绪" } });
      return;
    }
    set({ preview: { ...current, progress: progress.progress, stage: progress.stage, error: undefined } });
  },
  closePreview: () => {
    const current = useApp.getState().preview;
    if (current) void api.preview.dispose(current.trackId);
    set({ preview: null });
  },
  loginOpen: false,
  setLoginOpen: (loginOpen) => set({ loginOpen }),
  toasts: [],
  pushToast: (message, kind = "info") => {
    const id = ++toastId;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, kind === "error" ? 6500 : 4200);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
