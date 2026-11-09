import { EventEmitter } from "node:events";
import { AppError } from "../errors";
import type { Store } from "../store";
import { APP_ID, USER_AGENT, VERSION_CODE } from "./client";
import { readLocalSessionId } from "./cookie";
import type { DeviceIdentity } from "./identity";
import type { AuthState, QrSession, QrStatus } from "../../shared/types";

const PASSPORT = "https://api.qishui.com/passport";
const QR_QUERY = {
  passport_jssdk_version: "2.4.13",
  passport_jssdk_type: "normal",
  is_from_ttaccountsdk: "1",
  aid: APP_ID,
  next: "https://api.qishui.com",
};
const UA_HEADER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface MeResponse {
  status_code?: number;
  status_info?: { status_msg?: string };
  my_info?: Record<string, any>;
}

interface QrData {
  error_code?: number;
  description?: string;
  token?: string;
  qrcode?: string;
  expire_time?: number;
  qrcode_index_url?: string;
}

export class AuthManager extends EventEmitter {
  private sessionId = "";
  private state: AuthState = { connected: false, checking: true, source: null };

  constructor(
    private readonly store: Store,
    private readonly identity: DeviceIdentity,
    private readonly clientVersion: string,
  ) {
    super();
  }

  getState(): AuthState {
    return { ...this.state, deviceId: this.identity.did, clientVersion: this.clientVersion };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  requireSession(): string {
    if (!this.sessionId) {
      throw new AppError("AUTH_MISSING", "还没有登录汽水音乐，请先扫码或读取本机客户端登录态", "resolving");
    }
    return this.sessionId;
  }

  private emitState(): void {
    this.emit("auth", this.getState());
  }

  private applyMe(me: Record<string, any>, source: AuthState["source"]): AuthState {
    const avatar =
      me.larger_avatar_url?.urls?.[0] ||
      me.avatar_larger?.url_list?.[0] ||
      me.medium_avatar_url?.urls?.[0] ||
      me.avatar_medium?.url_list?.[0] ||
      me.avatar_thumb?.url_list?.[0] ||
      me.avatar_url ||
      "";
    this.state = {
      connected: true,
      checking: false,
      source,
      nickname: me.nickname || me.name || "汽水用户",
      avatar,
      uid: me.id ? String(me.id) : me.uid ? String(me.uid) : undefined,
      isVip: Boolean(me.is_vip || me.vip_info?.is_vip),
      vipStage: me.vip_stage || me.vip_info?.vip_stage || "",
      deviceId: this.identity.did,
      clientVersion: this.clientVersion,
    };
    this.emitState();
    return this.getState();
  }

  async restore(): Promise<AuthState> {
    this.state = { ...this.state, checking: true };
    this.emitState();

    const saved = this.store.getAuth();
    if (saved.manualLogout) {
      this.sessionId = "";
      this.state = {
        connected: false,
        checking: false,
        source: null,
        deviceId: this.identity.did,
        clientVersion: this.clientVersion,
        message: "已退出登录，扫码或读取本机客户端即可重新连接",
      };
      this.emitState();
      return this.getState();
    }
    if (saved.session) {
      const ok = await this.verify(saved.session);
      if (ok) {
        this.sessionId = saved.session;
        this.store.saveAuth({ session: saved.session, source: "saved", savedAt: Date.now() });
        this.applyMe(ok, "saved");
        return this.getState();
      }
    }

    try {
      const local = readLocalSessionId();
      if (local) {
        const ok = await this.verify(local);
        if (ok) {
          this.sessionId = local;
          this.store.saveAuth({ session: local, source: "client", savedAt: Date.now(), manualLogout: false });
          this.applyMe(ok, "client");
          return this.getState();
        }
      }
    } catch {
      /* ignore local read failures */
    }

    this.sessionId = "";
    this.state = {
      connected: false,
      checking: false,
      source: null,
      deviceId: this.identity.did,
      clientVersion: this.clientVersion,
      message: "登录态已失效，请扫码登录或重新打开汽水客户端",
    };
    this.emitState();
    return this.getState();
  }

  async connectLocal(): Promise<AuthState> {
    this.state = { ...this.state, checking: true };
    this.emitState();
    let local = "";
    try {
      local = readLocalSessionId();
    } catch (error) {
      throw new AppError("COOKIE_READ", "读取本机客户端登录态失败，请确认客户端已安装并登录", "resolving", String(error));
    }
    if (!local) {
      throw new AppError("COOKIE_EMPTY", "本机客户端没有登录态，请先打开汽水音乐登录，或使用扫码登录", "resolving");
    }
    const me = await this.verify(local);
    if (!me) {
      throw new AppError("COOKIE_INVALID", "本机客户端的登录态已失效，请重新登录客户端或扫码登录", "resolving");
    }
    this.sessionId = local;
    this.store.saveAuth({ session: local, source: "client", savedAt: Date.now(), manualLogout: false });
    return this.applyMe(me, "client");
  }

  async startQr(): Promise<QrSession> {
    const url = `${PASSPORT}/web/get_qrcode/?${new URLSearchParams(QR_QUERY).toString()}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { "user-agent": UA_HEADER }, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      throw new AppError("QR_NETWORK", "获取登录二维码失败，请检查网络", "resolving", String(error));
    }
    const text = await response.text();
    let json: { data?: QrData; message?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError("QR_PARSE", "登录二维码接口返回异常", "resolving", text.slice(0, 200));
    }
    const data = json.data || {};
    if (!data.qrcode || !data.token) {
      throw new AppError("QR_EMPTY", data.description || json.message || "没有拿到二维码，请稍后重试", "resolving");
    }
    return {
      token: data.token,
      qrcode: data.qrcode,
      expiresAt: data.expire_time ? data.expire_time * 1000 : Date.now() + 180000,
      indexUrl: data.qrcode_index_url,
    };
  }

  async pollQr(token: string): Promise<QrStatus> {
    const query = {
      passport_jssdk_version: QR_QUERY.passport_jssdk_version,
      passport_jssdk_type: QR_QUERY.passport_jssdk_type,
      is_from_ttaccountsdk: QR_QUERY.is_from_ttaccountsdk,
      aid: APP_ID,
      iid: this.identity.iid,
    };
    const body = new URLSearchParams({
      need_logo: "false",
      need_short_url: "false",
      is_frontier: "true",
      token,
      is_new_login: "1",
      next: "https://api.qishui.com",
    });
    let response: Response;
    try {
      response = await fetch(`${PASSPORT}/web/check_qrconnect/?${new URLSearchParams(query).toString()}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA_HEADER },
        body,
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      return { status: "error", message: "轮询登录状态失败：" + (error instanceof Error ? error.message : String(error)) };
    }

    const text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    const data = json.data || {};
    const sid = this.sessionFromResponse(response, data);
    const status = String(data.status || "").toLowerCase();

    if (sid) {
      const me = await this.verify(sid);
      if (me) {
        this.sessionId = sid;
        this.store.saveAuth({ session: sid, source: "qr", savedAt: Date.now(), manualLogout: false });
        const auth = this.applyMe(me, "qr");
        return { status: "confirmed", auth };
      }
      return { status: "error", message: "登录成功但校验账号失败，请重试" };
    }

    if (status === "confirmed" || status === "scanned" || status === "new") {
      return { status: status as QrStatus["status"] };
    }
    if (data.error_code && Number(data.error_code) !== 0) {
      return { status: "error", message: data.description || "二维码状态异常，请刷新" };
    }
    return { status: "new" };
  }

  private sessionFromResponse(response: Response, data: any): string {
    try {
      const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      for (const item of cookies) {
        const match = item.match(/sessionid=([^;,\s]+)/);
        if (match && match[1] && match[1] !== "0") return decodeURIComponent(match[1]);
      }
    } catch {
      /* ignore */
    }
    if (data?.sessionid) return String(data.sessionid);
    const redirect = String(data?.redirect_url || "");
    if (redirect.includes("sessionid=")) {
      const value = new URLSearchParams(redirect.split("?")[1] || "").get("sessionid");
      if (value) return value;
    }
    return "";
  }

  private async verify(sessionId: string): Promise<Record<string, any> | null> {
    try {
      const query = new URLSearchParams({ aid: APP_ID, iid: this.identity.iid, version_code: VERSION_CODE });
      const response = await fetch(`https://api.qishui.com/luna/pc/me?${query.toString()}`, {
        headers: { cookie: `sessionid=${sessionId}`, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      if (!text) return null;
      const json = JSON.parse(text) as MeResponse;
      if (json.status_code && json.status_code !== 0) return null;
      if (!json.my_info) return null;
      return json.my_info;
    } catch {
      return null;
    }
  }

  logout(): void {
    this.sessionId = "";
    this.store.saveAuth({ manualLogout: true, savedAt: Date.now() });
    this.state = {
      connected: false,
      checking: false,
      source: null,
      deviceId: this.identity.did,
      clientVersion: this.clientVersion,
      message: "已退出登录",
    };
    this.emitState();
  }
}
