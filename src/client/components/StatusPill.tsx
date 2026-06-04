import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "idle" | "success" | "warning" | "error" | "running";

interface StatusPillProps {
  tone: Tone;
  children: ReactNode;
}

const icons = {
  idle: null,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  running: Loader2
};

export function StatusPill({ tone, children }: StatusPillProps) {
  const Icon = icons[tone];
  return (
    <span className={`status-pill status-pill--${tone}`}>
      {Icon ? <Icon className={tone === "running" ? "spin" : undefined} size={14} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
