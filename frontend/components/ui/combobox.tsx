"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  sublabel?: string;
}

export interface ComboboxProps {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  invalid?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  size?: "sm" | "md";
  onEnterSelect?: () => void;
}

const inputBase =
  "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-primary";
const invalidRing =
  "border-[color:var(--danger)] focus:border-[color:var(--danger)]";

const MAX_PANEL = 288; // px, matches max-h-72

let idCounter = 0;

interface PanelPos { left: number; top: number; width: number; maxHeight: number; up: boolean }

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "No results",
  invalid,
  disabled,
  ariaLabel,
  autoFocus,
  className,
  size = "md",
  onEnterSelect,
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [pos, setPos] = React.useState<PanelPos | null>(null);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const baseId = React.useMemo(() => `combobox-${++idCounter}`, []);
  const listId = `${baseId}-list`;

  const selected = React.useMemo(() => options.find((o) => o.value === value), [options, value]);
  const selectedLabel = selected ? selected.label : "";

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel && o.sublabel.toLowerCase().includes(q)),
    );
  }, [options, query]);

  const displayValue = open ? query : selectedLabel;

  // Measure the trigger and decide whether the panel opens up or down.
  const updatePosition = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const up = spaceBelow < MAX_PANEL && spaceAbove > spaceBelow;
    const maxHeight = Math.min(MAX_PANEL, (up ? spaceAbove : spaceBelow) - 8);
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, maxHeight, up });
  }, []);

  const openList = React.useCallback(() => {
    if (disabled) return;
    updatePosition();
    setOpen(true);
  }, [disabled, updatePosition]);

  const closeList = React.useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // Reposition on scroll/resize while open; close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onScrollResize = () => updatePosition();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      closeList();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      document.removeEventListener("mousedown", onDocMouseDown);
    };
  }, [open, updatePosition, closeList]);

  // Keep the highlighted option scrolled into view.
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`#${baseId}-opt-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open, baseId, filtered]);

  function commit(opt: ComboOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
    onEnterSelect?.();
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    if (!open) openList();
    setHighlight(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) { openList(); setHighlight(0); return; }
        if (filtered.length) setHighlight((h) => (h + 1) % filtered.length);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!open) { openList(); setHighlight(filtered.length - 1); return; }
        if (filtered.length) setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
        return;
      case "Enter":
        if (open && filtered[highlight]) { e.preventDefault(); commit(filtered[highlight]); }
        return;
      case "Escape":
        if (open) { e.preventDefault(); e.stopPropagation(); closeList(); }
        return;
      case "Tab":
        if (open) closeList();
        return;
    }
  }

  function onClear(e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    onChange("");
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  }

  const showClear = !!value && !disabled;
  const inputH = size === "sm" ? "h-9" : "h-10";
  const optionPad = size === "sm" ? "py-1.5" : "py-2";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[highlight] ? `${baseId}-opt-${highlight}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        value={displayValue}
        onChange={onInputChange}
        onFocus={openList}
        onMouseDown={() => { if (!open) openList(); }}
        onKeyDown={onKeyDown}
        className={cn(inputBase, inputH, showClear && "pr-9", invalid && invalidRing, disabled && "opacity-60 cursor-not-allowed")}
      />

      {showClear && (
        <button
          type="button"
          aria-label="Clear selection"
          onMouseDown={onClear}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClear(e); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-muted hover:text-ink hover:bg-surface-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      )}

      {open && typeof document !== "undefined" && pos &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.up ? undefined : pos.top,
              bottom: pos.up ? window.innerHeight - pos.top : undefined,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-50 overflow-y-auto rounded-lg border border-border bg-surface shadow-[var(--shadow-md)] py-1"
          >
            {filtered.length === 0 ? (
              <li role="option" aria-selected={false} aria-disabled className="px-3 py-2 text-sm text-muted">{emptyText}</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isHighlighted = i === highlight;
                return (
                  <li
                    key={opt.value}
                    id={`${baseId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => { e.preventDefault(); commit(opt); }}
                    className={cn("px-3 text-sm cursor-pointer flex items-center justify-between gap-2", optionPad, isHighlighted && "bg-primary-tint text-ink")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.sublabel && <span className="block truncate text-xs text-muted">{opt.sublabel}</span>}
                    </span>
                    {isSelected && (
                      <svg className="text-[color:var(--accent)] shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </li>
                );
              })
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
