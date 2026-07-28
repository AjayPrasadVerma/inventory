"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Chip-style multi-value input — for units, colours, product types. */
export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (value.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, v]);
    setDraft("");
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  const available = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-surface p-1.5">
        {value.map((tag, i) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-sm text-ink"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-muted hover:text-[color:var(--danger)]"
              aria-label={`Remove ${tag}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              remove(value.length - 1);
            }
          }}
          onBlur={() => add(draft)}
          placeholder={value.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent px-1.5 py-1 text-sm text-ink outline-none placeholder:text-muted"
        />
      </div>
      {available.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {available.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs text-muted hover:text-ink hover:bg-surface-2",
              )}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
