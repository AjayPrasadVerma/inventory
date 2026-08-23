"use client";

import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("soft-card", className)}>{children}</div>;
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  success: "text-[color:var(--success)] bg-[color:var(--success-tint)]",
  warning: "text-[color:var(--warning)] bg-[color:var(--warning-tint)]",
  danger: "text-[color:var(--danger)] bg-[color:var(--danger-tint)]",
  accent: "text-[color:var(--accent)] bg-[color:var(--accent-tint)]",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      aria-label="Loading"
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-md text-[13px] text-muted">{hint}</p>}
    </div>
  );
}
