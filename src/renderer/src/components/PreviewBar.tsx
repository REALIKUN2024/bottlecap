import { useEffect, useRef, useState } from "react";
import { Pause, Play, SpeakerHigh, X } from "@phosphor-icons/react";
import { useApp } from "../store";
import { fmtDuration } from "../lib/format";
import { Cover, Spinner } from "./ui";

export default function PreviewBar() {
  const preview = useApp((state) => state.preview);
  const closePreview = useApp((state) => state.closePreview);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!preview?.url) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setPlaying(false);
      setTime(0);
      setDuration(0);
      return;
    }
    audio.src = preview.url;
    audio.load();
    setTime(0);
    setDuration((preview.durationMs || 0) / 1000);
    const promise = audio.play();
    if (promise) promise.catch(() => setPlaying(false));
  }, [preview?.url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (!preview) return null;

  const total = duration || (preview.durationMs || 0) / 1000;
  const percent = total > 0 ? Math.min(100, (time / total) * 100) : 0;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const close = () => {
    audioRef.current?.pause();
    closePreview();
  };

  return (
    <div className="preview-bar" role="region" aria-label="试听播放器">
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
      />
      <div className="pb-cover">
        <Cover url={preview.coverUrl} title={preview.name} artist={preview.artists.join("/")} />
      </div>
      <div className="pb-meta">
        <div className="pb-title">{preview.name}</div>
        <div className="pb-sub">
          {preview.artists.join(" / ")}
          {preview.previewOnly ? <span className="pb-flag">试听片段</span> : null}
        </div>
      </div>

      {preview.status === "loading" ? (
        <div className="pb-loading">
          <Spinner />
          <span>准备试听 · {Math.round(preview.progress)}%</span>
          <div className="pb-loadbar">
            <span style={{ width: `${Math.max(2, preview.progress)}%` }} />
          </div>
          <span className="tiny muted">{preview.stage === "downloading" ? "下载解密音频" : preview.stage === "decrypting" ? "拆封音频" : "解析曲目"}</span>
        </div>
      ) : preview.status === "error" ? (
        <div className="pb-error">
          <span>{preview.error || "试听准备失败"}</span>
        </div>
      ) : (
        <>
          <button className="pb-play" onClick={toggle} aria-label={playing ? "暂停试听" : "播放试听"}>
            {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
          </button>
          <span className="pb-time mono">{fmtDuration(time * 1000)}</span>
          <input
            className="pb-range"
            type="range"
            min={0}
            max={Math.max(1, total)}
            step={0.05}
            value={Math.min(time, total || 1)}
            aria-label="试听进度"
            style={{ background: `linear-gradient(to right, var(--accent) ${percent}%, var(--rule) ${percent}%)` }}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (audioRef.current) audioRef.current.currentTime = value;
              setTime(value);
            }}
          />
          <span className="pb-time mono">{fmtDuration(total * 1000)}</span>
          <div className="pb-vol">
            <SpeakerHigh size={15} />
            <input
              className="pb-vol-range"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              aria-label="音量"
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
        </>
      )}

      <button className="pb-close" onClick={close} aria-label="关闭试听">
        <X size={15} />
      </button>
    </div>
  );
}
