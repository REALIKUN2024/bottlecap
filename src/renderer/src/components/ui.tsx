import { useEffect, useState, type ElementType, type ReactNode } from "react";
import { Check, WarningCircle, X } from "@phosphor-icons/react";
import { useApp, type ToastItem } from "../store";
import { initials, stageIndex, STAGE_TEXT, toneFor } from "../lib/format";
import type { Stage } from "../../../shared/types";

export function IconButton({
  label,
  onClick,
  children,
  className = "",
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button className={`icon-btn ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Cover({
  url,
  title,
  artist,
  className = "",
}: {
  url?: string;
  title: string;
  artist?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const tone = toneFor((title || "") + (artist || ""));
  return (
    <div className={`cover-wrap ${className}`} style={{ position: "relative", overflow: "hidden" }}>
      {url && !failed ? (
        <img className="cover-img" src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="cover-fallback" style={{ background: `linear-gradient(145deg,${tone.from},${tone.to})` }}>
          <span>{initials(title)}</span>
        </div>
      )}
    </div>
  );
}

export function Badge({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "ghost" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "" : tone === "ghost" ? "ghost" : tone === "warn" ? "warn" : "danger";
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} className={option.value === value ? "on" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

export function EmptyState({
  icon: IconComponent,
  title,
  description,
  actions,
}: {
  icon: ElementType;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art">
        <IconComponent size={26} />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
    </div>
  );
}

const PIPELINE = ["解析", "签名", "下载", "解密", "封装"];

export function Pipeline({ stage }: { stage: Stage }) {
  const index = stageIndex(stage);
  const done = stage === "done";
  return (
    <div className="pipeline" role="list" aria-label="处理管线">
      {PIPELINE.map((label, i) => {
        const state = done || index > i ? "done" : index === i ? "active" : "pending";
        return (
          <div key={label} style={{ display: "contents" }}>
            <div className={`step ${state}`} role="listitem">
              <span className="pin" />
              {label}
            </div>
            {i < PIPELINE.length - 1 ? <div className={`step-line ${done || index > i ? "done" : ""}`} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={ariaLabel}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((state) => state.toasts);
  const dismiss = useApp((state) => state.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast: ToastItem) => (
        <div key={toast.id} className={`toast ${toast.kind === "error" ? "error" : ""}`}>
          {toast.kind === "error" ? <WarningCircle size={16} /> : <Check size={16} />}
          <span>{toast.message}</span>
          <button className="close" onClick={() => dismiss(toast.id)} aria-label="关闭提示">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} aria-live="polite">
      <span className="spin" />
      {label ? <span className="muted tiny">{label}</span> : null}
    </span>
  );
}

export function StageLabel({ stage }: { stage: Stage }) {
  return <>{STAGE_TEXT[stage]}</>;
}
