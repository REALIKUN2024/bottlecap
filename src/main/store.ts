import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { HistoryEntry, Settings } from "../shared/types";

export interface SavedAuth {
  session?: string;
  source?: "qr" | "client" | "saved";
  savedAt?: number;
  manualLogout?: boolean;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) } as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export class Store {
  readonly dir: string;
  readonly settingsFile: string;
  readonly historyFile: string;
  readonly authFile: string;
  private settings: Settings;
  private history: HistoryEntry[] = [];
  private savedAuth: SavedAuth = {};

  constructor() {
    this.dir = app.getPath("userData");
    this.settingsFile = path.join(this.dir, "settings.json");
    this.historyFile = path.join(this.dir, "history.json");
    this.authFile = path.join(this.dir, "auth.bin");
    const defaults: Settings = {
      outputDir: path.join(app.getPath("music"), "Bottlecap"),
      format: "original",
      mp3Bitrate: 320,
      concurrency: 2,
      writeTags: true,
      embedLyrics: true,
      writeLrc: true,
      filenameTemplate: "{artist} - {title}",
      clientDir: "",
      ffmpegPath: "",
    };
    this.settings = readJson<Settings>(this.settingsFile, defaults);
    const h = readJson<{ entries?: HistoryEntry[] }>(this.historyFile, { entries: [] });
    this.history = Array.isArray(h.entries) ? h.entries : [];
    this.savedAuth = this.loadAuth();
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    writeJsonAtomic(this.settingsFile, this.settings);
    return this.getSettings();
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  addHistory(entry: HistoryEntry): void {
    this.history = [entry, ...this.history.filter((e) => e.id !== entry.id)].slice(0, 2000);
    writeJsonAtomic(this.historyFile, { entries: this.history });
  }

  removeHistory(id: string): void {
    this.history = this.history.filter((e) => e.id !== id);
    writeJsonAtomic(this.historyFile, { entries: this.history });
  }

  clearHistory(): void {
    this.history = [];
    writeJsonAtomic(this.historyFile, { entries: this.history });
  }

  getAuth(): SavedAuth {
    return { ...this.savedAuth };
  }

  saveAuth(auth: SavedAuth): void {
    this.savedAuth = auth;
    const payload = JSON.stringify(auth);
    try {
      if (safeStorage.isEncryptionAvailable()) {
        fs.mkdirSync(path.dirname(this.authFile), { recursive: true });
        fs.writeFileSync(this.authFile, safeStorage.encryptString(payload));
        return;
      }
    } catch {
      /* fall through */
    }
    fs.mkdirSync(path.dirname(this.authFile), { recursive: true });
    fs.writeFileSync(this.authFile, Buffer.from(payload, "utf8"));
  }

  clearAuth(): void {
    this.savedAuth = {};
    try {
      fs.rmSync(this.authFile, { force: true });
    } catch {
      /* ignore */
    }
  }

  private loadAuth(): SavedAuth {
    try {
      if (!fs.existsSync(this.authFile)) return {};
      const buf = fs.readFileSync(this.authFile);
      let text: string;
      if (safeStorage.isEncryptionAvailable()) {
        try {
          text = safeStorage.decryptString(buf);
        } catch {
          text = buf.toString("utf8");
        }
      } else {
        text = buf.toString("utf8");
      }
      return JSON.parse(text) as SavedAuth;
    } catch {
      return {};
    }
  }
}
