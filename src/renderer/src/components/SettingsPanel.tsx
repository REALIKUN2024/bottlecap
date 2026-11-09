import { FolderOpen } from "@phosphor-icons/react";
import { useApp } from "../store";
import { api } from "../lib/api";
import { formatLabel } from "../lib/format";
import type { Format } from "../../../shared/types";
import { Segmented, Toggle } from "./ui";

export default function SettingsPanel() {
  const settings = useApp((state) => state.settings);
  const setSettings = useApp((state) => state.setSettings);
  const tasks = useApp((state) => state.tasks);
  const auth = useApp((state) => state.auth);
  const pushToast = useApp((state) => state.pushToast);

  if (!settings) return null;

  const update = async (patch: Partial<typeof settings>) => {
    try {
      setSettings(await api.settings.update(patch));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "设置保存失败", "error");
    }
  };

  const chooseDir = async () => {
    const dir = await api.settings.chooseDir();
    if (dir) await update({ outputDir: dir });
  };

  const done = tasks.filter((task) => task.stage === "done").length;
  const pending = tasks.filter((task) => !["done", "failed", "canceled"].includes(task.stage)).length;

  return (
    <aside className="inspector" aria-label="输出设置">
      <div className="insp-head">
        <h2>输出设置</h2>
        <div className="spacer" />
        <span className="tiny muted">对队列生效</span>
      </div>

      <div className="field">
        <label>格式</label>
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
      </div>

      <div className="field">
        <label>保存到</label>
        <div className="path">
          <span title={settings.outputDir}>{settings.outputDir}</span>
          <button aria-label="选择目录" onClick={chooseDir}>
            <FolderOpen size={14} />
          </button>
        </div>
        <div className="filename">
          {settings.filenameTemplate}.{"{ext}"}
          <br />
          示例：陈粒 - 小半.{settings.format === "original" ? "flac" : settings.format}
        </div>
      </div>

      <div className="field">
        <label>元数据</label>
        <div className="row-switch">
          <span className="lbl">封面与标签</span>
          <Toggle on={settings.writeTags} onChange={(value) => void update({ writeTags: value })} label="写入封面与标签" />
        </div>
        <div className="row-switch">
          <span className="lbl">歌词（嵌入）</span>
          <Toggle on={settings.embedLyrics} onChange={(value) => void update({ embedLyrics: value })} label="嵌入歌词" />
        </div>
        <div className="row-switch">
          <span className="lbl">同时保存 .lrc</span>
          <Toggle on={settings.writeLrc} onChange={(value) => void update({ writeLrc: value })} label="生成 lrc" />
        </div>
      </div>

      <div className="field">
        <label>并发下载 <span className="hint">推荐 2</span></label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="small muted">同时处理</span>
          <div className="stepper">
            <button aria-label="减少并发" onClick={() => void update({ concurrency: Math.max(1, settings.concurrency - 1) })}>
              –
            </button>
            <b>{String(settings.concurrency).padStart(2, "0")}</b>
            <button aria-label="增加并发" onClick={() => void update({ concurrency: Math.min(4, settings.concurrency + 1) })}>
              +
            </button>
          </div>
        </div>
      </div>

      <div className="insp-foot">
        <div className="foot-title">本次任务</div>
        <div className="foot-line"><span>队列中</span><b>{pending}</b></div>
        <div className="foot-line"><span>已完成</span><b>{done}</b></div>
        <div className="foot-line"><span>输出格式</span><b>{formatLabel(settings.format)}</b></div>
        <div className="foot-line"><span>签名设备</span><b>{auth?.deviceId ? `${auth.deviceId.slice(0, 4)}…${auth.deviceId.slice(-4)}` : "—"}</b></div>
        <div className="foot-line"><span>客户端</span><b>{auth?.clientVersion || "未检测到"}</b></div>
      </div>
    </aside>
  );
}
