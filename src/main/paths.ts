import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS_BASES = [
  process.env.QS_CLIENT_BASE,
  "D:\\Soda Music",
  path.join(process.env.LOCALAPPDATA || "", "SodaMusic"),
  path.join(process.env.PROGRAMFILES || "", "Soda Music"),
].filter(Boolean) as string[];

const MAC_BASES = [
  path.join(os.homedir(), "Library", "Containers", "com.soda.music", "Data", "Library", "Application Support", "SodaMusic"),
];

export interface ClientPaths {
  dir: string;
  version: string;
  unpacked: string;
  mssdk: string;
  bdms: string;
}

export function findClientDir(preferred?: string): ClientPaths | null {
  const bases = preferred ? [preferred, ...WINDOWS_BASES] : [...WINDOWS_BASES, ...MAC_BASES];
  for (const base of bases) {
    if (!base || !fs.existsSync(base)) continue;
    if (fs.existsSync(path.join(base, "resources", "app.asar.unpacked", "bdms.node"))) {
      return toClientPaths(base);
    }
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(base).filter((n) => /^\d+\.\d+\.\d+$/.test(n));
    } catch {
      continue;
    }
    entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const dir = path.join(base, entries[i]);
      if (fs.existsSync(path.join(dir, "resources", "app.asar.unpacked", "bdms.node"))) {
        return toClientPaths(dir);
      }
    }
  }
  return null;
}

function toClientPaths(dir: string): ClientPaths {
  const unpacked = path.join(dir, "resources", "app.asar.unpacked");
  return {
    dir,
    version: path.basename(dir),
    unpacked,
    mssdk: path.join(dir, "mssdk"),
    bdms: path.join(unpacked, "bdms.node"),
  };
}

export function sodaDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Containers", "com.soda.music", "Data", "Library", "Application Support", "SodaMusic");
  }
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "SodaMusic");
}

export function localCookiesPath(): string {
  return path.join(sodaDataDir(), "Network", "Cookies");
}

export function deviceV1Path(): string {
  return path.join(sodaDataDir(), "DeviceV1");
}
