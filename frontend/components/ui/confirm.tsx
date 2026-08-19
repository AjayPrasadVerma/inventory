"use client";

import { Button } from "./button";
import { Modal } from "./modal";
import { Spinner } from "./misc";

/**
 * Custom confirmation dialog — replaces the native `confirm()` alert.
 * Render it with a controlled `open` boolean; `onConfirm` runs the action,
 * `onClose` dismisses (Cancel / backdrop / Esc all animate out).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  tone = "danger",
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={(close) => (
        <>
          <Button variant="outline" onClick={close} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={loading}>
            {loading ? <Spinner /> : confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
    </Modal>
  );
}
