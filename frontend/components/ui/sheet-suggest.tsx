"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * A sheet cell that suggests without restricting.
 *
 * This replaces `<datalist>`. A datalist popup is drawn by the browser and
 * cannot be styled at all — no colour, no font, nothing — and Safari renders it
 * against the input's own background, which made the suggestions unreadable
 * inside a tinted cell. Declaring color-scheme lined up every other native
 * control but not this one, because the popup is not really following the page
 * at all. The only way to control how it looks is to stop using it.
 *
 * The list is positioned fixed, computed from the input's own rect, so it is not
 * clipped by the sheet's scroll container the way an absolutely positioned child
 * would be. It closes on scroll rather than trying to follow it.
 *
 * Typing something absent from the list stays valid — that is the whole point
 * here, since a name the shop has never recorded is created on save.
 */
export function SheetSuggest({
  value,
  onChange,
  options,
  onEnter,
  className,
  placeholder,
  ariaLabel,
  inputRef,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** Called when Enter should advance instead of accepting a suggestion. */
  onEnter: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "placeholder" | "ref">) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const elRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of options) {
      if (!o) continue;
      const k = o.toLowerCase();
      if (seen.has(k)) continue;
      if (q && !k.includes(q)) continue;
      seen.add(k);
      out.push(o);
      if (out.length === 8) break;
    }
    // Nothing to offer when the typed value already is the only match.
    if (out.length === 1 && out[0]!.toLowerCase() === q) return [];
    return out;
  }, [options, value]);

  const show = open && matches.length > 0;

  useLayoutEffect(() => {
    if (!show) return;
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom, width: Math.max(r.width, 180) });
  }, [show, value]);

  // Following a scrolling cell would mean re-measuring on every frame; closing is
  // both cheaper and what a picker is expected to do.
  useEffect(() => {
    if (!show) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [show]);

  function accept(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (show) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      // A highlighted suggestion takes Enter; otherwise Enter advances the sheet.
      if (e.key === "Enter" && matches[active]) {
        e.preventDefault();
        accept(matches[active]!);
        return;
      }
    }
    if (e.key === "Enter") onEnter(e);
  }

  return (
    <>
      <input
        {...rest}
        ref={(el) => { elRef.current = el; inputRef?.(el); }}
        className={className}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onFocus={(e) => { setOpen(true); setActive(0); rest.onFocus?.(e); }}
        // A click on the list must land before the blur closes it.
        onBlur={(e) => { setTimeout(() => setOpen(false), 120); rest.onBlur?.(e); }}
        onKeyDown={onKeyDown}
      />
      {show && rect && (
        <ul
          id={listId}
          role="listbox"
          className="fixed z-[60] max-h-64 overflow-y-auto rounded-lg border border-border-strong bg-surface py-1 shadow-[var(--shadow-md)]"
          style={{ left: rect.left, top: rect.top + 2, width: rect.width }}
        >
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // mousedown, not click: blur fires first on click and the list is
                // already gone by then.
                onMouseDown={(e) => { e.preventDefault(); accept(m); }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full cursor-pointer px-3 py-1.5 text-left text-sm ${
                  i === active ? "bg-primary-tint text-primary" : "text-ink"
                }`}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
