import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, CheckCircle, X } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useApp } from "../store";
import type { QrSession } from "../../../shared/types";
import { Spinner } from "./ui";

type Tab = "qr" | "local";

export default function LoginModal() {
  const open = useApp((state) => state.loginOpen);
  const setOpen = useApp((state) => state.setLoginOpen);
  const setAuth = useApp((state) => state.setAuth);
  const pushToast = useApp((state) => state.pushToast);
  const auth = useApp((state) => state.auth);

  const [tab, setTab] = useState<Tab>("qr");
  const [qr, setQr] = useState<QrSession | null>(null);
  const [status, setStatus] = useState<"new" | "scanned" | "confirmed" | "expired" | "error">("new");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef(false);

  const startQr = async () => {
    setLoading(true);
    setMessage("");
    setStatus("new");
    setQr(null);
    try {
      setQr(await api.auth.startQr());
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "获取二维码失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setTab("qr");
    void startQr();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== "qr" || !qr) return;
    pollRef.current = true;
    const tick = async () => {
      if (!pollRef.current) return;
      if (Date.now() > qr.expiresAt) {
        setStatus("expired");
        return;
      }
      try {
        const result = await api.auth.pollQr(qr.token);
        if (!pollRef.current) return;
        if (result.status === "confirmed" && result.auth) {
          pollRef.current = false;
          setAuth(result.auth);
          setStatus("confirmed");
          setMessage("登录成功");
          pushToast(`已登录：${result.auth.nickname || "汽水用户"}`);
          setTimeout(() => setOpen(false), 600);
          return;
        }
        if (result.status === "scanned") setStatus("scanned");
        if (result.status === "expired") setStatus("expired");
        if (result.status === "error") {
          setStatus("error");
          setMessage(result.message || "登录失败");
        }
      } catch (error) {
        if (!pollRef.current) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "轮询登录状态失败");
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      pollRef.current = false;
      clearInterval(timer);
    };
  }, [open, tab, qr?.token]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const countdown = useMemo(() => {
    if (!qr) return 0;
    return Math.max(0, Math.floor((qr.expiresAt - now) / 1000));
  }, [qr, now]);

  const connectLocal = async () => {
    setLocalLoading(true);
    setMessage("");
    try {
      const state = await api.auth.connectLocal();
      setAuth(state);
      pushToast(`已连接本机客户端：${state.nickname || "汽水用户"}`);
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取本机登录态失败");
    } finally {
      setLocalLoading(false);
    }
  };

  if (!open) return null;

  const statusText =
    status === "confirmed"
      ? "登录成功"
      : status === "scanned"
        ? "已扫码，请在手机上确认"
        : status === "expired"
          ? "二维码已失效"
          : status === "error"
            ? message || "登录失败"
            : qr
              ? `等待扫码 · ${countdown}s`
              : "正在获取二维码";

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">
          <X size={16} />
        </button>
        <h2 id="loginTitle">先连上你的汽水</h2>
        <p className="sub">登录凭据只留在本机主进程，不写日志、不上传。扫码一次即可下载账号里有权限的整曲。</p>

        <div className="tabs">
          <button className={`tab ${tab === "qr" ? "on" : ""}`} onClick={() => setTab("qr")}>
            扫码登录
          </button>
          <button className={`tab ${tab === "local" ? "on" : ""}`} onClick={() => setTab("local")}>
            使用本机客户端
          </button>
        </div>

        {tab === "qr" ? (
          <div className="qr-panel">
            <div className="qr-box">
              {loading ? (
                <div className="qr-placeholder"><Spinner label="获取二维码" /></div>
              ) : qr ? (
                <img src={qr.qrcode} alt="汽水音乐登录二维码" />
              ) : (
                <div className="qr-placeholder">{message || "暂时没有二维码"}</div>
              )}
            </div>
            <div className="qr-side">
              <ol className="steps">
                <li><b>01</b>打开手机上的「汽水音乐」或「抖音」</li>
                <li><b>02</b>点左上角扫一扫，扫描左侧二维码</li>
                <li><b>03</b>在手机上确认登录，应用会自动继续</li>
              </ol>
              <div className="status-line" aria-live="polite">
                <span className="dot" style={{ background: status === "error" || status === "expired" ? "var(--danger)" : undefined }} />
                <span>{statusText}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="btn btn-ghost" onClick={() => void startQr()} disabled={loading}>
                  <ArrowClockwise size={15} /> 刷新二维码
                </button>
                {status === "confirmed" ? (
                  <span className="status-line"><CheckCircle size={15} color="var(--accent)" /> 即将关闭</span>
                ) : null}
              </div>
              <p className="login-note">
                当前设备：{auth?.deviceId ? `${auth.deviceId.slice(0, 4)}…${auth.deviceId.slice(-4)}` : "读取中"}。
                二维码约 3 分钟有效；过期后点刷新即可。
              </p>
            </div>
          </div>
        ) : (
          <div>
            <p className="sub" style={{ marginBottom: 18 }}>
              直接读取本机已登录的汽水客户端，不需要再扫一次。适合客户端刚重新登录过的情况。
            </p>
            <div className="status-line" style={{ marginBottom: 18 }}>
              <span className={`dot ${auth?.connected ? "" : "warn"}`} />
              {auth?.connected ? `已连接：${auth.nickname || "汽水用户"}` : "当前没有可用的本机登录态"}
            </div>
            <button className="btn btn-primary" onClick={() => void connectLocal()} disabled={localLoading}>
              {localLoading ? <Spinner label="读取中" /> : "读取本机客户端登录态"}
            </button>
            <p className="login-note">
              会读取 <span className="mono">%APPDATA%\SodaMusic</span> 下的 Cookies 与 DeviceV1；
              客户端运行时也可以读取，程序会先复制副本。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
