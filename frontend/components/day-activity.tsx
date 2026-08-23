"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn, formatDate, qty as fmtQty, rupees, todayISO } from "@/lib/utils";
import { DateField } from "@/components/ui/date-field";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { Icon } from "@/components/icons";

type Kind = "purchase" | "issue" | "receipt" | "return" | "payment" | "adjustment";

interface Line { name: string; variant: string | null; unit: string; qty: string }
interface Event {
  kind: Kind;
  id: number;
  party: string | null;
  ref: string;
  amount: number | null;
  lines: Line[];
  note: string | null;
}
interface Activity {
  counts: Record<"purchases" | "issues" | "receipts" | "returns" | "payments" | "adjustments", number>;
  paid: number;
  events: Event[];
}

/** Label, colour and direction for each kind of thing that can happen in a day. */
const KIND: Record<Kind, { label: string; tone: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode }> = {
  purchase:   { label: "Purchase",        tone: "bg-primary-tint text-primary",                              icon: Icon.Purchase },
  issue:      { label: "Material issued", tone: "bg-[color:var(--warning-tint)] text-[color:var(--warning)]", icon: Icon.Karigar },
  receipt:    { label: "Goods received",  tone: "bg-[color:var(--success-tint)] text-[color:var(--success)]", icon: Icon.Product },
  return:     { label: "Material back",   tone: "bg-[color:var(--accent-tint)] text-[color:var(--accent)]",   icon: Icon.Item },
  payment:    { label: "Payment",         tone: "bg-[color:var(--success-tint)] text-[color:var(--success)]", icon: Icon.Ledger },
  adjustment: { label: "Adjustment",      tone: "bg-surface-2 text-muted",                                    icon: Icon.Item },
};

/** Order the feed reads in: goods movements first, money after. */
const ORDER: Kind[] = ["purchase", "issue", "receipt", "return", "adjustment", "payment"];

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * What happened on one day — purchases, material issued to karigars, goods that
 * came back, and money paid. The date is a control, so yesterday (or any past
 * day) is one click away instead of a different report.
 */
export function DayActivity() {
  const [date, setDate] = useState(() => todayISO());
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: Activity }>(`/reports/activity?date=${d}`);
      setData(res.data);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches the day's feed; state is set after await
  useEffect(() => { load(date); }, [date, load]);

  const events = useMemo(() => {
    const list = data?.events ?? [];
    return [...list].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.id - a.id);
  }, [data]);

  const isToday = date === todayISO();
  const total = events.length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h2 className="text-sm font-semibold text-ink">
            {isToday ? "Today's activity" : `Activity — ${formatDate(date)}`}
          </h2>
          <p className="text-xs text-muted">
            {loading ? "Loading…" : total === 0 ? "Nothing recorded" : `${total} ${total === 1 ? "entry" : "entries"}`}
            {!loading && data && data.paid > 0 && <> · paid {rupees(data.paid)}</>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setDate((d) => shiftDay(d, -1))}
            aria-label="Previous day"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border bg-surface text-muted hover:text-ink"
          >
            ‹
          </button>
          <div className="w-36">
            <DateField value={date} onChange={setDate} max={todayISO()} ariaLabel="Activity date" />
          </div>
          <button
            onClick={() => setDate((d) => shiftDay(d, 1))}
            disabled={isToday}
            aria-label="Next day"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border bg-surface text-muted hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            ›
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="h-9 cursor-pointer rounded-lg border border-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-2"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="px-4 py-8 text-center text-sm text-[color:var(--danger)]">{error}</p>
      ) : loading ? (
        <div className="py-12 text-center"><Spinner className="h-5 w-5 text-primary" /></div>
      ) : total === 0 ? (
        <EmptyState
          title={isToday ? "Nothing recorded today yet" : "Nothing happened on this day"}
          hint="Purchases, material issued to karigars, goods received and payments all show up here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e) => {
            const k = KIND[e.kind];
            const KIcon = k.icon;
            return (
              <li key={`${e.kind}-${e.id}`} className="flex items-start gap-3 px-4 py-2.5">
                <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", k.tone)}>
                  <KIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", k.tone)}>
                      {k.label}
                    </span>
                    {e.party && <span className="font-semibold text-ink">{e.party}</span>}
                    <span className="text-xs text-muted">{e.ref}</span>
                  </p>
                  {e.lines.length > 0 && (
                    <p className="mt-0.5 text-[13px] text-muted">
                      {e.lines.map((l, i) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          <span className="text-ink">{l.name}</span>
                          {l.variant ? ` (${l.variant})` : ""} · {fmtQty(l.qty)} {l.unit}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {e.amount != null && (
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">{rupees(e.amount)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
