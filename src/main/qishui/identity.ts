import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { deviceV1Path } from "../paths";

export interface DeviceIdentity {
  did: string;
  iid: string;
  cdid?: string;
}

function randomDigits(length: number): string {
  let out = String(1 + Math.floor(Math.random() * 9));
  while (out.length < length) out += Math.floor(Math.random() * 10);
  return out;
}

export function readClientIdentity(): DeviceIdentity | null {
  try {
    const file = deviceV1Path();
    if (!fs.existsSync(file)) return null;
    const raw = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    const json = JSON.parse(raw) as DeviceIdentity;
    if (!json.did || !json.iid) return null;
    return json;
  } catch {
    return null;
  }
}

export function resolveIdentity(stateDir: string): DeviceIdentity {
  const client = readClientIdentity();
  if (client) return client;

  const file = path.join(stateDir, "identity.json");
  try {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as DeviceIdentity;
      if (saved.did && saved.iid) return saved;
    }
  } catch {
    /* ignore */
  }
  const identity: DeviceIdentity = { did: randomDigits(16), iid: randomDigits(16) };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(identity, null, 2), "utf8");
  return identity;
}
