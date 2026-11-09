import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localCookiesPath } from "../paths";

export function readLocalSessionId(): string {
  const src = localCookiesPath();
  if (!fs.existsSync(src)) return "";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bottlecap-cookie-"));
  const copy = path.join(tmp, "Cookies");
  try {
    fs.copyFileSync(src, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT value FROM cookies WHERE host_key IN ('.qishui.com','qishui.com') AND name='sessionid' LIMIT 1")
        .get() as { value?: string } | undefined;
      return row?.value ? String(row.value) : "";
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
