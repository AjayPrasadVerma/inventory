"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const SIZE: Record<string, string> = {
  lg: "sm:max-w-lg",
  xl: "sm:max-w-3xl",
  // Page-sized: for forms that used to be their own route (line-item tables need the width).
  page: "sm:max-w-[min(96vw,76rem)]",
};

const CLOSE_MS = 160;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** A render function receives an animated `close()` — use it so buttons (e.g. Cancel) play the exit animation. */
  footer?: React.ReactNode | ((close: () => void) => React.ReactNode);
  size?: "lg" | "xl" | "page";
}) {
  const [closing, setClosing] = useState(false);

  // Play the exit animation, then hand control back to the parent to unmount.
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className={cn("absolute inset-0 bg-black/40", closing ? "acx-overlay-out" : "acx-overlay-in")}
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border bg-surface shadow-xl sm:rounded-2xl",
          SIZE[size],
          closing ? "acx-panel-out" : "acx-panel-in",
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b bg-surface px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-surface px-5 py-3">
            {typeof footer === "function" ? footer(close) : footer}
          </div>
        )}
      </div>
    </div>
  );
}
