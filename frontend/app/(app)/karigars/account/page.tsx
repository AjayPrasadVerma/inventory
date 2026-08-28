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
  /** null for a payment that belongs to no movement of its own. */
  direction: Direction | null;
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

  // Newest at the top of every column. The API already returns the log that way;
  // this used to reverse it so a column read like a page being filled downward,
  // but what the owner actually opens the khata for is the entry just made.
  const ins = useMemo(() => entries.filter((e) => e.direction === "in"), [entries]);
  const outs = useMemo(() => entries.filter((e) => e.direction === "out"), [entries]);
  // Money is its own stack: a payment attached to a movement and a lump sum with
  // no movement both belong here, and neither should appear twice.
  const money = useMemo(() => entries.flatMap((e) => e.payments), [entries]);

  const hasFilter = !!from || !!to || !!search;
  const paidShown = money.reduce((n, p) => n + p.amount, 0);

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

          {/* Three independent stacks, not one row per entry. Pairing every
              movement into a shared row left half of the table showing a dash,
              which the owner reads as wasted space rather than as information.
              Each column now packs its own entries oldest-first, so the newest
              sits at the bottom of its own column and the two sides grow at
              whatever rate the work actually happened. */}
          <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_1fr_15rem]">
            <Stack
              title="Item In"
              headClass="khata-head-in"
              bodyClass="khata-col-in"
              action={
                <StackButton onClick={() => setEntryForm("in")} label="+ In" aria="Record goods coming in" className="bg-[color:var(--success)] text-white" />
              }
              empty="Nothing received in this range."
            >
              {ins.map((e) => (
                <EntryBlock key={e.id} entry={e} onDelete={isOwner ? () => setPendingDelete({ id: e.id, label: `In on ${formatDate(e.date)}` }) : undefined} />
              ))}
            </Stack>

            <Stack
              title="Raw Material"
              headClass="khata-head-raw"
              bodyClass="khata-col-raw"
              action={
                <StackButton onClick={() => setEntryForm("out")} label="+ Out" aria="Issue material out" className="bg-[color:var(--accent)] text-white" />
              }
              empty="Nothing issued in this range."
            >
              {outs.map((e) => (
                <EntryBlock key={e.id} entry={e} onDelete={isOwner ? () => setPendingDelete({ id: e.id, label: `Out on ${formatDate(e.date)}` }) : undefined} />
              ))}
            </Stack>

            {/* Every rupee paid in range, however it was linked. A payment made
                against one of the old jobs carries a job_id and a lump sum
                carries nothing, so following only the entry link showed a total
                of zero while the money sat in the table. */}
            <Stack
              title="Payment"
              headClass="khata-head-pay"
              bodyClass="khata-col-pay"
              action={
                <StackButton onClick={() => setPayOpen(true)} label="+ Pay" aria="Record a payment" className="bg-primary text-primary-fg" />
              }
              empty="No payment in this range."
            >
              {money.map((p) => (
                <div key={p.id} className="border-b border-border-strong px-3 py-2.5 last:border-b-0">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[13px] font-semibold text-muted">{formatDate(p.date)}</span>
                    <span className="font-mono text-[15px] font-bold tabular-nums text-ink">{rupees(p.amount)}</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted">{p.method || "—"}</span>
                </div>
              ))}
            </Stack>
          </div>

          <p className="mt-2 text-[12.5px] font-semibold uppercase tracking-wide text-muted">
            {ins.length} in · {outs.length} out · {rupees(paidShown)} paid
          </p>
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

/** One column of the khata: a coloured header carrying its own action, and a
 *  stack of blocks beneath it. */
function Stack({
  title, headClass, bodyClass, action, empty, children,
}: {
  title: string;
  headClass: string;
  bodyClass: string;
  action: React.ReactNode;
  empty: string;
  children: React.ReactNode;
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children;
  return (
    <div className="overflow-hidden rounded-xl border border-border-strong">
      <div className={`${headClass} flex items-center justify-between gap-3 border-b border-border-strong px-3 py-2.5`}>
        <span className="text-sm font-bold uppercase tracking-[0.07em]">{title}</span>
        {action}
      </div>
      <div className={`${bodyClass} min-h-[6rem]`}>
        {isEmpty ? <p className="px-3 py-8 text-center text-sm text-muted">{empty}</p> : children}
      </div>
    </div>
  );
}

function StackButton({
  onClick, label, aria, className,
}: { onClick: () => void; label: string; aria: string; className: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={aria}
      className={`cursor-pointer rounded-md px-3 py-1 text-[13px] font-semibold transition-opacity hover:opacity-85 ${className}`}
    >
      {label}
    </button>
  );
}

/** One movement in a column: when, why, and what moved. */
function EntryBlock({ entry, onDelete }: { entry: Entry; onDelete?: () => void }) {
  return (
    <div className="border-b border-border-strong px-3 py-2.5 last:border-b-0">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-muted">{formatDate(entry.date)}</span>
        {onDelete && (
          <button
            onClick={onDelete}
            className="cursor-pointer text-[12.5px] text-muted underline-offset-2 hover:text-[color:var(--danger)] hover:underline"
          >
            Delete
          </button>
        )}
      </span>
      {entry.remark && (
        <span className="mt-0.5 block truncate text-[12.5px] text-muted" title={entry.remark}>{entry.remark}</span>
      )}
      <div className="mt-1">
        <LineList lines={entry.lines} />
      </div>
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
