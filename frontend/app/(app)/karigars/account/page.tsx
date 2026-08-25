"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { bustCache, cachedGet } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { formatDate, qty as fmtQty, rupees, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/confirm";
import { PageHeader } from "@/components/page-parts";
import { Icon } from "@/components/icons";
import { KarigarForm, type Karigar } from "@/components/karigar-form";
import { PayKarigarModal } from "@/components/pay-karigar-modal";
import { KarigarEntryModal, type Direction } from "@/components/karigar-entry-modal";

interface KarigarLite { id: number; name: string; phone: string | null }
interface EntryLine { id: number; name: string; size: string | null; design: string | null; qty: string }
interface PayLine { id: number; date: string; method: string | null; amount: number }
interface Entry {
  id: number;
  direction: Direction;
  date: string;
  remark: string | null;
  lines: EntryLine[];
  payments: PayLine[];
  paid: number;
}
interface Log {
  entries: Entry[];
  totals: { in: number; out: number; paid: number };
}

/**
 * A karigar's khata as an ordered log.
 *
 * It used to be job-wise: material issued on one side, goods received on the
 * other, paired per job. That forced an order the shop does not work in — you
 * could not record goods arriving unless material had gone out against that same
 * job first. Now every movement is its own entry, listed newest first, and an
 * entry sits in the column for its direction: green when something came in,
 * yellow when material went out. Reading down the page shows the real sequence.
 *
 * The colours carry the meaning at a distance, which is why the actions live in
 * the column headers rather than on each row — one In, one Out, one Pay.
 */
export default function KarigarAccountPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const isOwner = user?.role === "owner";

  const [karigars, setKarigars] = useState<KarigarLite[]>([]);
  // The record on screen comes from the URL, not from local state: the command
  // palette navigates by changing only ?k=, which does not remount this segment,
  // so anything read once on mount would ignore it.
  const karigarId = params.get("k") ?? "";
  const setKarigarId = useCallback(
    (id: string) => router.replace(id ? `?k=${id}` : "?", { scroll: false }),
    [router],
  );
  const [karigar, setKarigar] = useState<Karigar | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opens on the current month — the range a shop looks at most.
  const [from, setFrom] = useState(() => `${todayISO().slice(0, 8)}01`);
  const [to, setTo] = useState(() => todayISO());
  const [search, setSearch] = useState("");

  const [editKarigar, setEditKarigar] = useState(false);
  const [entryForm, setEntryForm] = useState<Direction | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; label: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    cachedGet<{ data: KarigarLite[] }>("/karigars/options")
      .then((r) => setKarigars(r.data))
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadAccount = useCallback(async (id: string, f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (f) qs.set("from", f);
      if (t) qs.set("to", t);
      const [k, l] = await Promise.all([
        api<{ data: Karigar }>(`/karigars/${id}`),
        api<{ data: Log }>(`/karigars/${id}/entries?${qs.toString()}`),
      ]);
      setKarigar(k.data);
      setLog(l.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!karigarId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads account data after a karigar or range change
    loadAccount(karigarId, from, to);
  }, [karigarId, from, to, loadAccount]);

  const refresh = useCallback(() => {
    if (karigarId) loadAccount(karigarId, from, to);
  }, [karigarId, from, to, loadAccount]);

  const karigarOptions = useMemo<ComboOption[]>(
    () => karigars.map((k) => ({ value: String(k.id), label: k.name, sublabel: k.phone || undefined })),
    [karigars],
  );

  // Search filters what is already loaded. The API takes a search term too, but
  // refetching per keystroke would be a request a letter for no better answer.
  const term = search.trim().toLowerCase();
  const entries = useMemo(() => {
    const all = log?.entries ?? [];
    if (!term) return all;
    return all.filter((e) =>
      [e.remark ?? "", ...e.lines.flatMap((l) => [l.name, l.size ?? "", l.design ?? ""])]
        .join(" ").toLowerCase().includes(term));
  }, [log, term]);

  const hasFilter = !!from || !!to || !!search;
  const paidShown = entries.reduce((n, e) => n + e.paid, 0);

  async function confirmDelete() {
    if (!pendingDelete || !karigarId) return;
    setDeleteLoading(true);
    try {
      await api(`/karigars/${karigarId}/entries/${pendingDelete.id}`, { method: "DELETE" });
      toast("Entry deleted", "success");
      setPendingDelete(null);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="w-full pb-10">
      <PageHeader
        backHref="/karigars"
        title={karigar?.name ?? "Karigar account"}
        subtitle={karigar ? [karigar.phone, karigar.product_types?.join(", ")].filter(Boolean).join(" · ") || undefined : undefined}
        actions={karigarId ? (
          <Button variant="outline" onClick={() => setEditKarigar(true)} title="Karigar details">
            <Icon.Edit /> <span className="hidden lg:inline">Details</span>
          </Button>
        ) : undefined}
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <Label>Karigar</Label>
            <Combobox options={karigarOptions} value={karigarId} onChange={setKarigarId} placeholder="Search karigar…" ariaLabel="Karigar" />
          </div>
          <div className="w-full sm:w-[19rem]">
            <Label>Date range</Label>
            <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} disabled={!karigarId} />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Label>Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item / size / remark…" disabled={!karigarId} />
          </div>
          {hasFilter && <Button variant="outline" onClick={() => { setFrom(""); setTo(""); setSearch(""); }}>Clear</Button>}
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p>}

      {!karigarId ? (
        <Card className="mt-3"><EmptyState title="Select a karigar" hint="Pick a karigar above to open its account." /></Card>
      ) : loading ? (
        <div className="py-20 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : log ? (
        <>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Tile label="Item in" value={String(log.totals.in)} tone="in" />
            <Tile label="Material out" value={String(log.totals.out)} tone="out" />
            <Tile label="Total paid" value={rupees(log.totals.paid)} tone="pay" />
          </div>

          <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-xs)]">
            <div className="overflow-auto">
              <table className="ledger-table w-full border-separate border-spacing-0 text-base md:min-w-[1130px]">
                {/* The actions live here, not on each row: one In, one Out, one
                    Pay, each sitting on the colour it belongs to. */}
                <thead className="sticky top-0 z-10">
                  <tr className="text-sm uppercase tracking-[0.07em]">
                    <th className="w-28 whitespace-nowrap border-b border-border-strong bg-surface-2 px-3 py-3 text-left font-bold text-muted">
                      Date
                    </th>
                    <th className="khata-head-in w-[33%] border-b border-border-strong px-3 py-2.5 text-left font-bold">
                      <span className="flex items-center justify-between gap-3">
                        Item In
                        <button
                          onClick={() => setEntryForm("in")}
                          aria-label="Record goods coming in"
                          className="cursor-pointer rounded-md bg-[color:var(--success)] px-3 py-1 text-[13px] font-semibold normal-case tracking-normal text-white transition-opacity hover:opacity-85"
                        >
                          + In
                        </button>
                      </span>
                    </th>
                    <th className="khata-head-raw w-[33%] border-b border-l border-border-strong px-3 py-2.5 text-left font-bold">
                      <span className="flex items-center justify-between gap-3">
                        Raw Material
                        <button
                          onClick={() => setEntryForm("out")}
                          aria-label="Issue material out"
                          className="cursor-pointer rounded-md bg-[color:var(--accent)] px-3 py-1 text-[13px] font-semibold normal-case tracking-normal text-white transition-opacity hover:opacity-85"
                        >
                          + Out
                        </button>
                      </span>
                    </th>
                    <th className="khata-head-pay w-[13rem] border-b border-l border-border-strong px-3 py-2.5 text-left font-bold">
                      <span className="flex items-center justify-between gap-3">
                        Payment
                        <button
                          onClick={() => setPayOpen(true)}
                          aria-label="Record a payment"
                          className="cursor-pointer rounded-md bg-primary px-3 py-1 text-[13px] font-semibold normal-case tracking-normal text-primary-fg transition-opacity hover:opacity-85"
                        >
                          + Pay
                        </button>
                      </span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {entries.map((e) => {
                    const isIn = e.direction === "in";
                    const cell = "border-b border-border-strong px-3 py-2.5 align-top max-md:border-b-0";
                    return (
                      <tr key={e.id}>
                        <td data-label="Date" className={cell}>
                          <span className="block whitespace-nowrap font-mono text-[14px] font-semibold text-ink">
                            {formatDate(e.date)}
                          </span>
                          <span
                            className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              isIn
                                ? "bg-[color:var(--success-tint)] text-[color:var(--success)]"
                                : "bg-[color:var(--accent-tint)] text-[color:var(--accent)]"
                            }`}
                          >
                            {isIn ? "In" : "Out"}
                          </span>
                          {e.remark && (
                            <span className="mt-0.5 block max-w-[6.5rem] truncate text-[12px] text-muted" title={e.remark}>
                              {e.remark}
                            </span>
                          )}
                          {isOwner && (
                            <button
                              onClick={() => setPendingDelete({ id: e.id, label: `${isIn ? "In" : "Out"} on ${formatDate(e.date)}` })}
                              className="mt-1 cursor-pointer text-[12.5px] text-muted underline-offset-2 hover:text-[color:var(--danger)] hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </td>

                        {/* An entry only ever fills the column for its own
                            direction. The blank side is what makes the sequence
                            readable down the page. */}
                        <td data-label="Item In" className={`${cell} khata-col-in`}>
                          {isIn ? <LineList lines={e.lines} /> : <span className="text-sm text-muted">—</span>}
                        </td>
                        <td data-label="Raw Material" className={`${cell} khata-col-raw border-l border-border-strong max-md:border-l-0`}>
                          {isIn ? <span className="text-sm text-muted">—</span> : <LineList lines={e.lines} />}
                        </td>
                        <td data-label="Payment" className={`${cell} khata-col-pay border-l border-border-strong max-md:border-l-0`}>
                          {e.payments.length === 0 ? (
                            <span className="text-sm text-muted">—</span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-base font-bold tabular-nums text-ink">{rupees(e.paid)}</span>
                              {e.payments.map((p) => (
                                <span key={p.id} className="text-[13.5px] text-muted">
                                  {p.method || "—"}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {entries.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-10 text-center text-muted">
                      Nothing recorded{hasFilter ? " in this range" : " yet"}.
                    </td></tr>
                  )}
                </tbody>

                <tfoot>
                  <tr>
                    <td colSpan={4} className="border-t border-border-strong bg-surface-2 px-3 py-2.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted">
                      {entries.length < (log.entries.length)
                        ? `${entries.length} of ${log.entries.length}`
                        : entries.length} entries · {rupees(paidShown)} paid
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {editKarigar && karigar && (
        <KarigarForm
          karigar={karigar}
          onClose={() => setEditKarigar(false)}
          onSaved={() => { setEditKarigar(false); bustCache("/karigars/options"); refresh(); }}
        />
      )}

      {entryForm && karigar && (
        <KarigarEntryModal
          karigarId={karigar.id}
          karigarName={karigar.name}
          direction={entryForm}
          onClose={() => setEntryForm(null)}
          onDone={() => { setEntryForm(null); refresh(); }}
        />
      )}

      {payOpen && karigar && (
        <PayKarigarModal
          karigarId={karigar.id}
          karigarName={karigar.name}
          onClose={() => setPayOpen(false)}
          onDone={() => { setPayOpen(false); refresh(); }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete entry?"
        message={
          <>
            Deleting <span className="font-semibold text-ink">{pendingDelete?.label}</span> will reverse the
            stock it moved and remove any advance paid with it. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        tone="danger"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** The lines of one entry: what moved, in what size and design, how much. */
function LineList({ lines }: { lines: EntryLine[] }) {
  const [open, setOpen] = useState(false);
  const LIMIT = 6;
  const shown = open ? lines : lines.slice(0, LIMIT);
  const hidden = lines.length - shown.length;
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((l) => (
        <span key={l.id} className="text-[15px] font-medium">
          {l.name}
          {(l.size || l.design) && (
            <span className="text-muted">
              {" ("}
              {[l.size, l.design].filter(Boolean).join(" · ")}
              {")"}
            </span>
          )}
          <span className="text-muted"> · {fmtQty(Number(l.qty))}</span>
        </span>
      ))}
      {(hidden > 0 || open) && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 w-fit cursor-pointer text-[13px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {open ? "Show less" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  in: "khata-col-in text-[color:var(--success)]",
  out: "khata-col-raw text-[color:var(--accent)]",
  pay: "khata-col-pay text-[color:var(--primary)]",
};

function Tile({ label, value, tone }: { label: string; value: string; tone: keyof typeof TILE_TONE }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-1.5 ${TILE_TONE[tone]}`}>
      <span className="truncate text-[13px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="shrink-0 text-[17px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}
