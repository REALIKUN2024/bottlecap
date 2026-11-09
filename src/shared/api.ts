import type {
  AuthState, ClientProbe, Format, HistoryEntry, PlaylistDetail, PlaylistSummary,
  PreviewProgress, PreviewSource, QrSession, QrStatus, QueueSnapshot, Settings, Task, TrackDetail, TrackSummary,
} from "./types";

export interface ResolveResult { trackId: string; detail: TrackDetail }
export interface SearchResult { tracks: TrackSummary[]; hasMore: boolean; cursor: string }

export interface BottlecapApi {
  auth: {
    status(): Promise<AuthState>;
    connectLocal(): Promise<AuthState>;
    startQr(): Promise<QrSession>;
    pollQr(token: string): Promise<QrStatus>;
    logout(): Promise<AuthState>;
    onAuth(callback: (state: AuthState) => void): () => void;
  };
  tracks: {
    resolve(input: string): Promise<ResolveResult>;
    search(query: string, cursor?: string): Promise<SearchResult>;
  };
  playlists: {
    list(): Promise<PlaylistSummary[]>;
    detail(id: string): Promise<PlaylistDetail>;
  };
  downloads: {
    enqueue(tracks: TrackSummary[], format?: Format): Promise<Task[]>;
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
    retry(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    reveal(path: string): Promise<void>;
    snapshot(): Promise<QueueSnapshot>;
    clearFinished(): Promise<void>;
    onUpdate(callback: (snapshot: QueueSnapshot) => void): () => void;
  };
  preview: {
    start(trackId: string): Promise<PreviewSource>;
    dispose(trackId: string): Promise<void>;
    onProgress(callback: (progress: PreviewProgress) => void): () => void;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
    chooseDir(): Promise<string>;
  };
  history: {
    list(): Promise<HistoryEntry[]>;
    remove(id: string): Promise<HistoryEntry[]>;
    clear(): Promise<HistoryEntry[]>;
    reveal(path: string): Promise<void>;
  };
  app: {
    probe(): Promise<ClientProbe>;
    openPath(path: string): Promise<void>;
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
}
