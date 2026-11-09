import { AppError } from "../errors";
import type { ClientPaths } from "../paths";
import type { DeviceIdentity } from "./identity";
import { signRequest } from "./signer";

export const APP_ID = "386088";
export const APP_VERSION = "3.5.1";
export const VERSION_CODE = "30050100";
export const USER_AGENT = `LunaPC/${APP_VERSION}(${VERSION_CODE})`;
const API = "https://api.qishui.com";

export interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signed?: boolean;
  timeoutMs?: number;
}

export class QishuiClient {
  constructor(
    readonly client: ClientPaths,
    readonly identity: DeviceIdentity,
    private sessionId: string,
  ) {}

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getSession(): string {
    return this.sessionId;
  }

  private baseQuery(extra: Record<string, string | number | undefined> = {}): Record<string, string> {
    const query: Record<string, string> = {
      aid: APP_ID,
      app_name: "luna_pc",
      device_platform: "windows",
      device_type: "Windows",
      os_version: "Windows 11",
      version_name: APP_VERSION,
      version_code: VERSION_CODE,
      device_id: this.identity.did,
      iid: this.identity.iid,
      fp: this.identity.did,
      channel: "official",
      tz_name: "Asia/Shanghai",
    };
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) query[key] = String(value);
    }
    return query;
  }

  async request<T = unknown>(pathname: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const query = this.baseQuery(options.query);
    const url = `${API}${pathname}?${new URLSearchParams(query).toString()}`;
    const headers: Record<string, string> = {
      cookie: `sessionid=${this.sessionId}`,
      "user-agent": USER_AGENT,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json; charset=utf-8";

    const finalHeaders: Record<string, string> = { ...headers };
    if (options.signed !== false) {
      Object.assign(finalHeaders, signRequest(this.client, this.identity.did, url, headers));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
      });
    } catch (error) {
      throw new AppError("NETWORK", "网络请求失败，请检查连接后重试", "fetching", error instanceof Error ? error.message : String(error));
    }

    const text = await response.text();
    if (!text) {
      throw new AppError(
        "SIGN_EMPTY",
        "内容接口返回空响应：签名未通过，可能需要更新汽水客户端版本",
        "signing",
      );
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError("BAD_JSON", "接口返回了无法解析的内容", "fetching", text.slice(0, 200));
    }
    if (json && typeof json.status_code === "number" && json.status_code !== 0) {
      const msg = json.status_info?.status_msg || `接口错误（${json.status_code}）`;
      throw new AppError(`API_${json.status_code}`, msg, "fetching");
    }
    return json as T;
  }
}
