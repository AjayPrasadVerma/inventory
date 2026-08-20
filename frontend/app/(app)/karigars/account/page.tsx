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
import { JobModal } from "@/components/job-modal";
import { ReceiveGoodsModal } from "@/components/receive-goods-modal";

interface KarigarLite { id: number; name: string; phone: string | null }
interface Issued { name: string; color: string | null; unit: string; qty: string }
interface Received { name: string; variant: string | null; qty: string }
interface PayLine { id: number; date: string; method: string | null; amount: number }
interface Job {
  id: number;
  date: string;
  status: "open" | "closed";
  note: string | null;
  issued: Issued[];
  received: Received[];
  returned: Issued[];
  payments: PayLine[];
  paid: number;
}
interface Unlinked { id: number; date: string; method: string | null; amount: number; note: string | null }
interface Khata {
  jobs: Job[];
  unlinked: Unlinked[];
  totals: { jobs: number; open: number; paid: number };
}

type PendingDelete =
  | { kind: "job"; id: number; label: string }
  | { kind: "payment"; id: number; label: string };

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
  const [khata, setKhata] = useState<Khata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opens on the current month — the range a shop looks at most.
  const [from, setFrom] = useState(() => `${todayISO().slice(0, 8)}01`);
  const [to, setTo] = useState(() => todayISO());
  const [search, setSearch] = useState("");

  const [editKarigar, setEditKarigar] = useState(false);
  const [newJob, setNewJob] = useState(false);
  const [receiveJob, setReceiveJob] = useState<number | null>(null);
  const [payModal, setPayModal] = useState<{ jobId: number; ref: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    cachedGet<{ data: KarigarLite[] }>("/karigars/options")
      .then((r) => {
        setKarigars(r.data);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const loadAccount = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [k, kh] = await Promise.all([
        api<{ data: Karigar }>(`/karigars/${id}`),
        api<{ data: Khata }>(`/karigars/${id}/ledger`),
      ]);
      setKarigar(k.data);
      setKhata(kh.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!karigarId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads account data after a karigar change
    loadAccount(karigarId);
  }, [karigarId, loadAccount]);

  const refresh = useCallback(() => { if (karigarId) loadAccount(karigarId); }, [karigarId, loadAccount]);

  const karigarOptions = useMemo<ComboOption[]>(
    () => karigars.map((k) => ({ value: String(k.id), label: k.name, sublabel: k.phone || undefined })),
    [karigars],
  );

  const s = search.trim().toLowerCase();
  const hasFilter = !!(from || to || s);

  /** Jobs shown after the date/search filter. Totals stay all-time so Total paid
   *  always matches the karigar's real figure on the list page. */
  const jobs = useMemo(() => {
    const all = khata?.jobs ?? [];
    return all.filter((j) =>
      (!from || j.date >= from) && (!to || j.date <= to) &&
      (!s ||
        String(j.id).includes(s) ||
        (j.note ?? "").toLowerCase().includes(s) ||
        j.issued.some((i) => i.name.toLowerCase().includes(s) || (i.color ?? "").toLowerCase().includes(s)) ||
        j.received.some((r) => r.name.toLowerCase().includes(s) || (r.variant ?? "").toLowerCase().includes(s)) ||
        j.payments.some((p) => (p.method ?? "").toLowerCase().includes(s))),
    );
  }, [khata, from, to, s]);

  const unlinked = useMemo(() => {
    const all = khata?.unlinked ?? [];
    return all.filter((u) =>
      (!from || u.date >= from) && (!to || u.date <= to) &&
      (!s || (u.method ?? "").toLowerCase().includes(s) || (u.note ?? "").toLowerCase().includes(s)),
    );
  }, [khata, from, to, s]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteLoading(true);
    try {
      const path = pendingDelete.kind === "job" ? `/jobs/${pendingDelete.id}` : `/payments/${pendingDelete.id}`;
      await api(path, { method: "DELETE" });
      toast(pendingDelete.kind === "job" ? "Job deleted — stock reversed." : "Payment deleted", "success");
      setPendingDelete(null);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleteLoading(false);
    }
  }

  const payCount = (khata?.jobs ?? []).reduce((n, j) => n + j.payments.length, 0) + (khata?.unlinked.length ?? 0);

  return (
    <div className="w-full pb-10">
      <PageHeader
        backHref="/karigars"
        title={karigar?.name ?? "Karigar account"}
        subtitle={karigar ? [karigar.phone, karigar.product_types?.join(", ")].filter(Boolean).join(" · ") || undefined : undefined}
        actions={karigarId ? (
          <>
            <Button variant="outline" onClick={() => setEditKarigar(true)} title="Karigar details"><Icon.Edit /> <span className="hidden lg:inline">Details</span></Button>
            <Button onClick={() => setNewJob(true)}><Icon.Plus /> <span className="hidden sm:inline">Issue material</span></Button>
          </>
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
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job / material / product…" disabled={!karigarId} />
          </div>
          {hasFilter && <Button variant="outline" onClick={() => { setFrom(""); setTo(""); setSearch(""); }}>Clear</Button>}
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p>}

      {!karigarId ? (
        <Card className="mt-3"><EmptyState title="Select a karigar" hint="Pick a karigar above to open its khata." /></Card>
      ) : loading ? (
        <div className="py-20 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : khata ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Tile label="Total jobs" value={String(khata.totals.jobs)} tone="accent" />
            <Tile label="Open jobs" value={String(khata.totals.open)} tone={khata.totals.open > 0 ? "warning" : "muted"} />
            <Tile label="Total paid" value={rupees(khata.totals.paid)} tone="success" />
          </div>

          {/* ── Job-wise khata: what went out (diya) against what came back (aaya) ── */}
          <div className="mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-xs)]">
            <div className="max-h-[calc(100vh-300px)] min-h-[16rem] overflow-auto">
              <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-base">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th colSpan={3} className="border-b border-border-strong bg-surface-2 px-4 py-2.5 text-left text-sm font-semibold text-[color:var(--accent)]">
                      Material issued
                    </th>
                    <th className="border-b border-l-2 border-border-strong border-l-border-strong bg-surface-2 px-4 py-2.5 text-left text-sm font-semibold text-[color:var(--success)]">
                      Goods received &amp; payment
                    </th>
                  </tr>
                  <tr className="text-xs uppercase tracking-[0.09em] text-muted">
                    <th className="w-28 whitespace-nowrap border-b border-border-strong bg-surface px-4 py-2 text-left font-semibold">Date</th>
                    <th className="w-32 whitespace-nowrap border-b border-border-strong bg-surface px-4 py-2 text-left font-semibold">Job</th>
                    <th className="border-b border-border-strong bg-surface px-4 py-2 text-left font-semibold">Diya — raw material</th>
                    <th className="w-[40%] whitespace-nowrap border-b border-l-2 border-border-strong border-l-border-strong bg-surface px-4 py-2 text-left font-semibold">
                      Aaya — goods · paid
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {jobs.map((j) => {
                    const done = j.status === "closed";
                    const cell = `border-b border-border-strong px-4 py-2.5 align-top ${done ? "bg-[color:var(--success-tint)]" : ""}`;
                    return (
                      <tr key={j.id}>
                        <td className={`${cell} whitespace-nowrap font-mono text-sm font-semibold text-muted`}>{formatDate(j.date)}</td>
                        <td className={cell}>
                          <span className="whitespace-nowrap font-mono text-[15px] font-semibold text-ink">#{j.id}</span>
                          {j.note && <span className="mt-0.5 block max-w-[9rem] truncate text-[12px] text-muted" title={j.note}>{j.note}</span>}
                          <span className="mt-1 flex gap-3 text-[13px]">
                            <button onClick={() => router.push(`/jobs/detail?j=${j.id}`)} className="cursor-pointer text-muted underline-offset-2 hover:text-ink hover:underline">Open</button>
                            {isOwner && (
                              <button onClick={() => setPendingDelete({ kind: "job", id: j.id, label: `Job #${j.id}` })} className="cursor-pointer text-muted underline-offset-2 hover:text-[color:var(--danger)] hover:underline">Delete</button>
                            )}
                          </span>
                        </td>
                        <td className={`${cell} text-[15px] font-medium`}>
                          {j.issued.length === 0 ? <span className="text-muted">—</span> : (
                            <>
                              {j.issued.length > 3 && (
                                <span className="mb-1.5 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                                  {j.issued.length} items
                                </span>
                              )}
                              <div className={j.issued.length > 3 ? "columns-2 gap-x-8" : undefined}>
                                {j.issued.map((it, k) => (
                                  <span key={k} className="block break-inside-avoid">
                                    {it.name}
                                    {it.color ? <span className="text-muted"> ({it.color})</span> : null}
                                    <span className="text-muted"> · {fmtQty(it.qty)} {it.unit}</span>
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                          {j.returned.length > 0 && (
                            <span className="mt-1.5 block text-[13px] text-muted">
                              Returned: {j.returned.map((r) => `${r.name}${r.color ? ` (${r.color})` : ""} · ${fmtQty(r.qty)} ${r.unit}`).join(", ")}
                            </span>
                          )}
                        </td>
                        <td className={`border-b border-l-2 border-border-strong border-l-border-strong px-4 py-2.5 align-top ${done ? "bg-[color:var(--success-tint)]" : ""}`}>
                          <ReturnBox
                            done={done}
                            received={j.received}
                            payments={j.payments}
                            paid={j.paid}
                            onReceive={() => setReceiveJob(j.id)}
                            onPay={() => setPayModal({ jobId: j.id, ref: `Job #${j.id}` })}
                            onDeletePay={isOwner ? (p) => setPendingDelete({ kind: "payment", id: p.id, label: `${rupees(p.amount)} on ${formatDate(p.date)}` }) : undefined}
                          />
                        </td>
                      </tr>
                    );
                  })}

                  {/* Lump sums not tied to any job — still part of what the karigar was paid. */}
                  {unlinked.map((u) => (
                    <tr key={`u${u.id}`}>
                      <td className="border-b border-border-strong px-4 py-2.5 align-top font-mono text-sm font-semibold text-muted">{formatDate(u.date)}</td>
                      <td className="border-b border-border-strong px-4 py-2.5 align-top font-mono text-[15px] text-muted">—</td>
                      <td className="border-b border-border-strong px-4 py-2.5 align-top text-[15px] font-medium text-muted">
                        Payment not tied to a job{u.note ? ` · ${u.note}` : ""}
                      </td>
                      <td className="border-b border-l-2 border-border-strong border-l-border-strong px-4 py-2.5 align-top">
                        <PayRow line={{ id: u.id, date: u.date, method: u.method, amount: u.amount }}
                          onDelete={isOwner ? () => setPendingDelete({ kind: "payment", id: u.id, label: `${rupees(u.amount)} on ${formatDate(u.date)}` }) : undefined} />
                      </td>
                    </tr>
                  ))}

                  {jobs.length === 0 && unlinked.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">
                      No jobs{hasFilter ? " match these filters" : " yet"}.
                    </td></tr>
                  )}
                </tbody>

                <tfoot>
                  <tr>
                    <td colSpan={3} className="border-t border-border-strong bg-surface-2 px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted">
                      {jobs.length < khata.jobs.length ? `${jobs.length} of ${khata.jobs.length}` : khata.jobs.length} jobs · {payCount} payments
                    </td>
                    <td className="border-l-2 border-t border-border-strong border-l-border-strong bg-surface-2 px-4 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Modals ───────────────────────────────────────────────────── */}
      {editKarigar && karigar && (
        <KarigarForm
          karigar={karigar}
          onClose={() => setEditKarigar(false)}
          onSaved={() => { setEditKarigar(false); bustCache("/karigars/options"); refresh(); }}
        />
      )}

      {newJob && karigar && (
        <JobModal
          karigarId={karigar.id}
          karigarName={karigar.name}
          onClose={() => setNewJob(false)}
          onDone={() => { setNewJob(false); refresh(); }}
        />
      )}

      {receiveJob !== null && karigar && (
        <ReceiveGoodsModal
          jobId={receiveJob}
          karigarName={karigar.name}
          onClose={() => setReceiveJob(null)}
          onDone={() => { setReceiveJob(null); refresh(); }}
        />
      )}

      {payModal && karigar && (
        <PayKarigarModal
          karigarId={karigar.id}
          karigarName={karigar.name}
          jobId={payModal.jobId}
          againstRef={payModal.ref}
          onClose={() => setPayModal(null)}
          onDone={() => { setPayModal(null); refresh(); }}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === "job" ? "Delete job?" : "Delete payment?"}
        message={
          pendingDelete?.kind === "job"
            ? <>Deleting <span className="font-semibold text-ink">{pendingDelete.label}</span> will reverse the material issued, any goods received, and any payment made for it. This cannot be undone.</>
            : <>Delete the payment of <span className="font-semibold text-ink">{pendingDelete?.label}</span>? This cannot be undone.</>
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

/** What came back for one job: goods made, then what was paid for it. */
function ReturnBox({
  done, received, payments, paid, onReceive, onPay, onDeletePay,
}: {
  done: boolean;
  received: Received[];
  payments: PayLine[];
  paid: number;
  onReceive: () => void;
  onPay: () => void;
  onDeletePay?: (p: PayLine) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Goods made</span>
        <span className="flex items-center gap-2">
          {done && <span className="text-[13px] font-bold uppercase tracking-wide text-[color:var(--success)]">Complete</span>}
          <button onClick={onReceive} className="cursor-pointer rounded-md bg-primary-tint px-2.5 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-fg">Receive</button>
        </span>
      </div>

      {received.length === 0 ? (
        <span className="text-sm font-medium text-muted">Nothing received yet</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {received.map((r, i) => (
            <span key={i} className="text-[15px] font-medium">
              {r.name}
              {r.variant ? <span className="text-muted"> ({r.variant})</span> : null}
              <span className="text-muted"> · {fmtQty(r.qty)} pcs</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Paid</span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-base font-bold tabular-nums text-[color:var(--success)]">{rupees(paid)}</span>
          <button onClick={onPay} className="cursor-pointer rounded-md bg-[color:var(--success-tint)] px-2.5 py-1 text-[13px] font-medium text-[color:var(--success)] transition-colors hover:bg-[color:var(--success)] hover:text-white">Pay</button>
        </span>
      </div>

      {payments.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {payments.map((p) => (
            <PayRow key={p.id} line={p} onDelete={onDeletePay ? () => onDeletePay(p) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

/** date · mode · amount — one payment. Delete stays hidden until hover to keep it quiet. */
function PayRow({ line, onDelete }: { line: PayLine; onDelete?: () => void }) {
  return (
    <div className="group grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-2.5">
      <span className="font-mono text-[13.5px] font-semibold text-muted">{formatDate(line.date)}</span>
      <span className="text-sm font-medium text-ink">{line.method || "—"}</span>
      <span className="font-mono text-[14.5px] font-bold tabular-nums text-[color:var(--success)]">{rupees(line.amount)}</span>
      {onDelete ? (
        <button onClick={onDelete} aria-label="Delete payment" className="cursor-pointer text-[13px] text-muted opacity-0 transition-opacity hover:text-[color:var(--danger)] group-hover:opacity-100">✕</button>
      ) : <span />}
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  accent: "bg-[color:var(--accent-tint)] text-[color:var(--accent)]",
  success: "bg-[color:var(--success-tint)] text-[color:var(--success)]",
  warning: "bg-[color:var(--warning-tint)] text-[color:var(--warning)]",
  muted: "bg-surface-2 text-muted",
};

function Tile({ label, value, tone }: { label: string; value: string; tone: keyof typeof TILE_TONE }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-1.5 ${TILE_TONE[tone]}`}>
      <span className="truncate text-[13px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="shrink-0 text-[17px] font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}
