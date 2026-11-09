import { createRequire } from "node:module";
import type { ClientPaths } from "../paths";
import { AppError } from "../errors";

const nativeRequire = createRequire(__filename);

interface BdmsModule {
  init(options: { deviceId: string }): void;
  generateHttpSignatureHeaders(url: string, headers: string): string;
  report(...args: unknown[]): void;
}

let moduleRef: BdmsModule | null = null;
let initializedDid: string | null = null;

export function loadSigner(client: ClientPaths): BdmsModule {
  if (moduleRef) return moduleRef;
  process.env.PATH = [client.unpacked, client.mssdk, process.env.PATH || ""].join(";");
  try {
    moduleRef = nativeRequire(client.bdms) as BdmsModule;
  } catch (error) {
    throw new AppError(
      "BDMS_LOAD",
      "签名模块加载失败：客户端安装不完整或版本不兼容",
      "signing",
      error instanceof Error ? error.message : String(error),
    );
  }
  return moduleRef;
}

export function signRequest(client: ClientPaths, deviceId: string, url: string, headers: Record<string, string>): Record<string, string> {
  const bdms = loadSigner(client);
  if (initializedDid !== deviceId) {
    try {
      bdms.init({ deviceId });
    } catch (error) {
      throw new AppError(
        "BDMS_INIT",
        "签名模块初始化失败（客户端可能不支持当前系统）",
        "signing",
        error instanceof Error ? error.message : String(error),
      );
    }
    initializedDid = deviceId;
  }
  const headersStr = Object.entries(headers).flatMap(([key, value]) => [key, value]).join("\r\n");
  let raw = "";
  try {
    raw = String(bdms.generateHttpSignatureHeaders(url, headersStr) || "");
  } catch (error) {
    throw new AppError("BDMS_SIGN", "生成签名失败", "signing", error instanceof Error ? error.message : String(error));
  }
  const signature: Record<string, string> = {};
  const parts = raw.split("\r\n").filter(Boolean);
  for (let i = 0; i < parts.length; i += 2) signature[parts[i]] = parts[i + 1];
  return signature;
}
