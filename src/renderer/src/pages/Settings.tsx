import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  FolderOpen,
  Plugs,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useApp } from "../store";
import type { ClientProbe, Format } from "../../../shared/types";
import { Segmented, Spinner, Toggle } from "../components/ui";

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="label">{label}</div>
        {help ? <div className="help">{help}</div> : null}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const settings = useApp((state) => state.settings);
  const setSettings = useApp((state) => state.setSettings);
  const auth = useApp((state) => state.auth);
  const setAuth = useApp((state) => state.setAuth);
  const setPlaylists = useApp((state) => state.setPlaylists);
  const probe = useApp((state) => state.probe);
  const setProbe = useApp((state) => state.setProbe);
  const setLoginOpen = useApp((state) => state.setLoginOpen);
  const pushToast = useApp((state) => state.pushToast);

  const [template, setTemplate] = useState(settings?.filenameTemplate || "");
  const [ffmpegPath, setFfmpegPath] = useState(settings?.ffmpegPath || "");
  const [probing, setProbing] = useState(false);

  useEffect(() => setTemplate(settings?.filenameTemplate || ""), [settings?.filenameTemplate]);
  useEffect(() => setFfmpegPath(settings?.ffmpegPath || ""), [settings?.ffmpegPath]);

  const loadProbe = async () => {
    setProbing(true);
    try {
      setProbe((await api.app.probe()) as ClientProbe);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "环境检测失败", "error");
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    void loadProbe();
  }, []);

  if (!settings) return null;

  const update = async (patch: Partial<typeof settings>) => {
    try {
      setSettings(await api.settings.update(patch));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "设置保存失败", "error");
    }
  };

  const chooseDir = async (target: "output" | "client") => {
    const dir = await api.settings.chooseDir();
    if (!dir) return;
    if (target === "output") await update({ outputDir: dir });
    else {
      await update({ clientDir: dir });
      await loadProbe();
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>改完立即生效，不需要重启。下载中的任务保持原有格式。</p>
        </div>
      </div>

      <div className="settings-grid">
        <div>
          <section className="setting-block">
            <h2>输出</h2>
            <Row label="保存目录" help="每首歌写入后做同目录去重">
              <div className="path w-full">
                <span title={settings.outputDir}>{settings.outputDir}</span>
                <button aria-label="选择目录" onClick={() => void chooseDir("output")}><FolderOpen size={14} /></button>
              </div>
              <button className="btn btn-ghost" style={{ height: 32 }} onClick={() => void api.app.openPath(settings.outputDir)}>打开</button>
            </Row>
            <Row label="输出格式" help="原格式保留上游容器">
              <Segmented<Format>
                label="输出格式"
                value={settings.format}
                onChange={(value) => void update({ format: value })}
                options={[
                  { value: "original", label: "原格式" },
                  { value: "flac", label: "FLAC" },
                  { value: "mp3", label: "MP3" },
                  { value: "wav", label: "WAV" },
                ]}
              />
            </Row>
            <Row label="MP3 码率" help="仅输出 MP3 时生效">
              <select
                className="inline-input"
                value={settings.mp3Bitrate}
                onChange={(event) => void update({ mp3Bitrate: Number(event.target.value) })}
              >
                {[128, 192, 256, 320].map((value) => <option key={value} value={value}>{value} kbps</option>)}
              </select>
            </Row>
            <Row label="文件名" help="可用 {artist} {title} {album} {trackId}">
              <input
                className="inline-input mono"
                style={{ width: 300 }}
                value={template}
                onChange={(event) => setTemplate(event.target.value)}
                onBlur={() => void update({ filenameTemplate: template || "{artist} - {title}" })}
                spellCheck={false}
              />
            </Row>
            <Row label="并发下载" help="1–4，默认 2">
              <div className="stepper">
                <button onClick={() => void update({ concurrency: Math.max(1, settings.concurrency - 1) })}>–</button>
                <b>{String(settings.concurrency).padStart(2, "0")}</b>
                <button onClick={() => void update({ concurrency: Math.min(4, settings.concurrency + 1) })}>+</button>
              </div>
            </Row>
          </section>

          <section className="setting-block">
            <h2>元数据</h2>
            <Row label="封面与标签" help="标题、歌手、专辑与封面写入文件">
              <Toggle on={settings.writeTags} onChange={(value) => void update({ writeTags: value })} label="写入封面与标签" />
            </Row>
            <Row label="歌词嵌入" help="把 QRC 转成纯文本写入文件">
              <Toggle on={settings.embedLyrics} onChange={(value) => void update({ embedLyrics: value })} label="嵌入歌词" />
            </Row>
            <Row label="生成 .lrc" help="与音频同名的逐行歌词文件">
              <Toggle on={settings.writeLrc} onChange={(value) => void update({ writeLrc: value })} label="生成 lrc" />
            </Row>
          </section>

          <section className="setting-block">
            <h2>高级</h2>
            <Row label="客户端目录" help="自动探测 D:\Soda Music 下最高版本">
              <div className="path w-full">
                <span>{settings.clientDir || probe?.dir || "未设置，自动探测"}</span>
                <button aria-label="选择客户端目录" onClick={() => void chooseDir("client")}><FolderOpen size={14} /></button>
              </div>
            </Row>
            <Row label="ffmpeg 路径" help="留空则使用内置或系统 PATH">
              <input
                className="inline-input mono"
                style={{ width: 300 }}
                placeholder="自动检测"
                value={ffmpegPath}
                onChange={(event) => setFfmpegPath(event.target.value)}
                onBlur={() => void update({ ffmpegPath })}
                spellCheck={false}
              />
            </Row>
            <Row label="环境检测">
              <button className="btn btn-ghost" style={{ height: 32 }} onClick={() => void loadProbe()} disabled={probing}>
                {probing ? <Spinner label="检测中" /> : <><ArrowClockwise size={14} /> 重新检测</>}
              </button>
            </Row>
          </section>
        </div>

        <aside>
          <section className="setting-block" style={{ paddingTop: 0 }}>
            <h2>账号</h2>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
              <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>
                {auth?.avatar ? <img src={auth.avatar} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : (auth?.nickname || "未").slice(0, 1)}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{auth?.nickname || "未登录"}</div>
                <div className="tiny muted">
                  {auth?.connected ? (auth.isVip ? "会员账号" : "普通账号") : "扫码登录后可用"}
                  {auth?.vipStage ? ` · ${auth.vipStage}` : ""}
                </div>
              </div>
            </div>
            <div className="status-line" style={{ marginBottom: 16 }}>
              <span className={`dot ${auth?.connected ? "" : "warn"}`} />
              {auth?.connected ? `已连接 · 来源 ${auth.source === "qr" ? "扫码" : auth.source === "client" ? "本机客户端" : "本地保存"}` : "未连接"}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" style={{ height: 34 }} onClick={() => setLoginOpen(true)}>
                <Plugs size={14} /> {auth?.connected ? "重新连接" : "连接账号"}
              </button>
              {auth?.connected ? (
                <button
                  className="btn btn-ghost"
                  style={{ height: 34 }}
                  onClick={async () => {
                    setAuth(await api.auth.logout());
                    setPlaylists([]);
                    pushToast("已退出登录");
                  }}
                >
                  <SignOut size={14} /> 退出
                </button>
              ) : null}
            </div>
            <div className="foot-line" style={{ marginTop: 18 }}><span>设备号</span><b>{auth?.deviceId ? `${auth.deviceId.slice(0, 4)}…${auth.deviceId.slice(-4)}` : "—"}</b></div>
            <div className="foot-line"><span>客户端</span><b>{probe?.version || auth?.clientVersion || "—"}</b></div>
          </section>

          <section className="setting-block">
            <h2>环境</h2>
            <div className="foot-line"><span>客户端目录</span><b title={probe?.dir}>{probe?.found ? "已找到" : "未找到"}</b></div>
            <div className="foot-line"><span>bdms.node</span><b>{probe?.hasBdms ? "√" : "×"}</b></div>
            <div className="foot-line"><span>DeviceV1</span><b>{probe?.hasDevice ? "√" : "×"}</b></div>
            <div className="foot-line"><span>Cookies</span><b>{probe?.hasCookie ? "√" : "×"}</b></div>
            <div className="foot-line"><span>ffmpeg</span><b>{probe?.ffmpeg ? "√" : "×"}</b></div>
            <div className="foot-line"><span>Electron / Node</span><b>{probe?.electron || "—"} / {probe?.node || "—"}</b></div>
            {!probe?.found ? (
              <div className="error-inline" style={{ marginTop: 12 }}>
                <WarningCircle size={15} />
                <div className="grow">没找到汽水客户端，下载与签名不可用。安装客户端后点「重新检测」。</div>
              </div>
            ) : (
              <div className="status-line" style={{ marginTop: 12 }}>
                <CheckCircle size={14} /> 签名模块已就绪
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
