"use client";

import { createContext, useCallback, useContext, useState } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => {
      // Skip if an identical toast is already on screen (prevents stacking spam,
      // e.g. React StrictMode double-firing effects).
      if (t.some((x) => x.message === message && x.kind === kind)) return t;
      return [...t, { id, kind, message }];
    });
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="rounded-lg border px-4 py-2.5 text-sm shadow-lg max-w-xs"
            style={{
              background: "var(--surface)",
              borderColor:
                t.kind === "error"
                  ? "var(--danger)"
                  : t.kind === "success"
                    ? "var(--success)"
                    : "var(--border)",
              color: "var(--ink)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
