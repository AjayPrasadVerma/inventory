"use client";

import { useEffect } from "react";
import { Button } from "./button";

const SIZE: Record<string, string> = {
  lg: "sm:max-w-lg",
  xl: "sm:max-w-3xl",
};

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
  footer?: React.ReactNode;
  size?: "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 w-full ${SIZE[size]} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border bg-surface shadow-xl`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b bg-surface px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-surface px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
