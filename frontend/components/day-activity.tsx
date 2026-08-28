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
  counts: Record<"purchases" | "issues" | "receipts" | "payments" | "adjustments", number>;
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

/**
 * Which of the three columns an event belongs in. The dashboard reads in the same
 * language as a karigar's khata — green for what came in, gold for what went out,
 * indigo for money — so the two screens do not have to be learned separately.
 *
 * A stock adjustment has no fixed side: it is filed by the sign of its quantity,
 * because a correction that adds stock is an arrival and one that removes it is
 * not.
 */
type Side = "in" | "out" | "pay";

function sideOf(e: Event): Side {
  if (e.kind === "payment") return "pay";
  if (e.kind === "issue") return "out";
  if (e.kind === "adjustment") {
    return e.lines.some((l) => Number(l.qty) < 0) ? "out" : "in";
  }
  // purchase and receipt both bring things into the shop.
  return "in";
}

const SIDES: { key: Side; label: string; head: string; body: string }[] = [
  { key: "in", label: "In", head: "khata-head-in", body: "khata-col-in" },
  { key: "out", label: "Out", head: "khata-head-raw", body: "khata-col-raw" },
  { key: "pay", label: "Pay", head: "khata-head-pay", body: "khata-col-pay" },
];

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

  const bySide = useMemo(() => {
    const out: Record<Side, Event[]> = { in: [], out: [], pay: [] };
    for (const e of data?.events ?? []) out[sideOf(e)].push(e);
    // Newest first inside each column, matching the khata.
    for (const k of Object.keys(out) as Side[]) out[k].sort((a, b) => b.id - a.id);
    return out;
  }, [data]);

  const total = (data?.events ?? []).length;

  const isToday = date === todayISO();

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
        <div className="grid grid-cols-1 md:grid-cols-3">
          {SIDES.map((side, i) => (
            <div
              key={side.key}
              className={`min-w-0 ${i > 0 ? "border-t border-border md:border-l md:border-t-0" : ""}`}
            >
              <div className={`${side.head} flex items-baseline justify-between border-b border-border-strong px-4 py-2 text-sm font-bold uppercase tracking-[0.07em]`}>
                {side.label}
                <span className="text-xs tabular-nums opacity-80">{bySide[side.key].length}</span>
              </div>

              <div className={`${side.body} h-full`}>
                {bySide[side.key].length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px] text-muted">Nothing</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {bySide[side.key].map((e) => (
                      <li key={`${e.kind}-${e.id}`} className="px-4 py-2.5">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", KIND[e.kind].tone)}>
                            {KIND[e.kind].label}
                          </span>
                          {e.party && <span className="font-semibold text-ink">{e.party}</span>}
                          {e.amount != null && (
                            <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-ink">
                              {rupees(e.amount)}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">{e.ref}</p>
                        {e.lines.length > 0 && (
                          <p className="mt-0.5 text-[13px] text-muted">
                            {e.lines.map((l, li) => (
                              <span key={li}>
                                {li > 0 && ", "}
                                <span className="text-ink">{l.name}</span>
                                {l.variant ? ` (${l.variant})` : ""} · {fmtQty(l.qty)} {l.unit}
                              </span>
                            ))}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
