"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cachedGet } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { formatDate, qty, todayISO } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import { Icon } from "@/components/icons";
import {
  MaterialRows, ProductRows, blankMaterial, blankProduct,
  materialPayload, productPayload,
  type ItemOpt, type ProductOpt, type MaterialLine, type ProductLine,
} from "@/components/material-rows";

interface JobDetail {
  id: number;
  karigar_id: number;
  karigar_name: string;
  job_date: string;
  expected_note: string | null;
  status: "open" | "closed";
  notes: string | null;
  issues: { id: number; item_id: number; variant_id: number | null; item_name: string; color: string | null; unit: string; qty: string; issued_on: string }[];
  receipts: { id: number; product_id: number; variant_id: number | null; product_name: string; variant: string | null; qty: string; received_on: string }[];
  returns: { id: number; item_name: string; color: string | null; unit: string; qty: string; moved_on: string }[];
}

type Mode = "main" | "pay" | "edit";

export default function JobDetailPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "1" ? "edit" : "main",
  );
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  // Fetch the job; state is set inside the promise so nothing is set synchronously.
  const load = useCallback((idNum: number) => {
    let alive = true;
    setLoading(true);
    setError(null);
    api<{ data: JobDetail }>(`/jobs/${idNum}`)
      .then((r) => { if (alive) setJob(r.data); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Read ?j=<id> once on mount (mirrors vendors/account reading ?v=).
  useEffect(() => {
    const idStr = new URLSearchParams(window.location.search).get("j");
    const idNum = idStr ? Number(idStr) : NaN;
    if (!idStr || Number.isNaN(idNum)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no valid ?j= id: stop the spinner and show not-found
      setLoading(false);
      return;
    }
    setJobId(idNum);
    return load(idNum);
  }, [load]);

  // Option lists for the issue/receive sub-flows (set only inside the promise).
  useEffect(() => {
    cachedGet<{ data: ItemOpt[] }>("/items/options").then((r) => setItems(r.data)).catch(() => {});
    cachedGet<{ data: ProductOpt[] }>("/products/options").then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    if (jobId == null) return;
    const r = await api<{ data: JobDetail }>(`/jobs/${jobId}`);
    setJob(r.data);
  }, [jobId]);

  async function afterChange(msg: string) {
    toast(msg, "success");
    await reload();
    setMode("main");
  }

  async function toggleStatus() {
    if (!job) return;
    const next = job.status === "open" ? "closed" : "open";
    setStatusSaving(true);
    try {
      await api(`/jobs/${job.id}`, { method: "PATCH", body: { status: next } });
      toast(next === "closed" ? "Job marked complete" : "Job reopened", "success");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStatusSaving(false);
    }
  }

  async function remove() {
    if (!job) return;
    if (!confirm(`Delete Job #${job.id}? This reverses the issued material and any received goods from stock.`)) return;
    setDeleting(true);
    try {
      await api(`/jobs/${job.id}`, { method: "DELETE" });
      toast("Job deleted", "success");
      router.push("/jobs");
    } catch (e) {
      toast((e as Error).message, "error");
      setDeleting(false);
    }
  }

  const title = job ? `Job #${job.id} — ${job.karigar_name}` : jobId ? `Job #${jobId}` : "Job";

  return (
    <div className="w-full pb-16">
      <PageHeader
        backHref="/jobs"
        title={title}
        subtitle="Material issue → goods receipt → finished stock."
        actions={
          job && mode === "main" ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setMode("edit")}><Icon.Edit /> Edit</Button>
              {user?.role === "owner" && (
                <Button size="sm" variant="danger" onClick={remove} disabled={deleting}>
                  {deleting ? <Spinner /> : <>Delete</>}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : error ? (
        <Card className="p-4"><EmptyState title="Couldn't load job" hint={error} /></Card>
      ) : !job ? (
        <Card className="p-4">
          <EmptyState title="Job not found" hint="This job may have been deleted, or the link is missing an id." />
          <div className="mt-3 text-center">
            <Button variant="outline" size="sm" onClick={() => router.push("/jobs")}>Back to jobs</Button>
          </div>
        </Card>
      ) : mode === "main" ? (
        <MainView job={job} onAction={setMode} onToggleStatus={toggleStatus} statusSaving={statusSaving} />
      ) : (
        <Card className="p-4 sm:p-6">
          {mode === "edit" ? (
            <EditView job={job} items={items} products={products} onBack={() => setMode("main")} onDone={afterChange} />
          ) : (
            <PayView job={job} onBack={() => setMode("main")} onDone={afterChange} />
          )}
        </Card>
      )}
    </div>
  );
}

function MainView({ job, onAction, onToggleStatus, statusSaving }: { job: JobDetail; onAction: (m: Mode) => void; onToggleStatus: () => void; statusSaving: boolean }) {
  const isClosed = job.status === "closed";
  const issuedSummary = job.issues.length === 0
    ? "Nothing issued yet"
    : `${job.issues.length} material${job.issues.length === 1 ? "" : "s"} issued`;
  const receivedSummary = job.receipts.length === 0
    ? "0 received yet"
    : `${job.receipts.length} receipt${job.receipts.length === 1 ? "" : "s"} received`;

  return (
    <div className="flex flex-col gap-4">
      {/* Compact status + action bar — stays on top, never pushed down by long tables */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge tone={isClosed ? "success" : "warning"}>{isClosed ? "Closed" : "Open"}</Badge>
          <span className="text-muted">{formatDate(job.job_date)}</span>
          {job.expected_note && (
            <>
              <span className="text-muted">·</span>
              <span className="text-muted">Make: <span className="text-ink">{job.expected_note}</span></span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onToggleStatus} disabled={statusSaving}>
            {statusSaving ? <Spinner /> : isClosed ? "Reopen" : "Mark complete"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAction("pay")}><Icon.Ledger /> Pay karigar</Button>
        </div>
      </div>

      {/* Two record sections — side by side on wide screens */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <Section title="Material issued" summary={issuedSummary}>
            {job.issues.length === 0 ? <Muted>Nothing issued yet.</Muted> : (
              <MiniTable head={["Date", "Material", "Color", "Unit", "Qty"]}>
                {job.issues.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{formatDate(r.issued_on)}</td>
                    <td className="py-1.5 pr-3 text-ink">{r.item_name}</td>
                    <td className="py-1.5 pr-3 text-muted">{r.color || "—"}</td>
                    <td className="py-1.5 pr-3 text-muted">{r.unit}</td>
                    <td className="py-1.5 text-right">{qty(r.qty)}</td>
                  </tr>
                ))}
              </MiniTable>
            )}
          </Section>
        </Card>

        <Card className="p-4">
          <Section title="Goods received" summary={receivedSummary}>
            {job.receipts.length === 0 ? <Muted>No goods received yet.</Muted> : (
              <MiniTable head={["Date", "Product", "Variant", "Qty"]}>
                {job.receipts.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{formatDate(r.received_on)}</td>
                    <td className="py-1.5 pr-3 text-ink">{r.product_name}</td>
                    <td className="py-1.5 pr-3 text-muted">{r.variant || "—"}</td>
                    <td className="py-1.5 text-right">{qty(r.qty)}</td>
                  </tr>
                ))}
              </MiniTable>
            )}
          </Section>
        </Card>
      </div>

      {job.returns.length > 0 && (
        <Card className="p-4">
          <Section title="Material returned" summary={`${job.returns.length} returned to stock`}>
            <MiniTable head={["Date", "Material", "Color", "Unit", "Qty"]}>
              {job.returns.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{formatDate(r.moved_on)}</td>
                  <td className="py-1.5 pr-3 text-ink">{r.item_name}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.color || "—"}</td>
                  <td className="py-1.5 pr-3 text-muted">{r.unit}</td>
                  <td className="py-1.5 text-right">{qty(r.qty)}</td>
                </tr>
              ))}
            </MiniTable>
          </Section>
        </Card>
      )}
    </div>
  );
}

function EditView({ job, items, products, onBack, onDone }: { job: JobDetail; items: ItemOpt[]; products: ProductOpt[]; onBack: () => void; onDone: (m: string) => void }) {
  const { toast } = useToast();
  const [jobDate, setJobDate] = useState(job.job_date.slice(0, 10));
  const [expected, setExpected] = useState(job.expected_note ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");
  // Pre-fill the material/product editors from the current job records (with a
  // trailing blank row for easy adding). Lazy initial state — computed once.
  const [matLines, setMatLines] = useState<MaterialLine[]>(() => {
    const rows = job.issues.map<MaterialLine>((i) => ({
      ...blankMaterial(),
      itemId: String(i.item_id),
      variantId: i.variant_id ? String(i.variant_id) : "",
      unit: i.unit,
      qty: String(i.qty),
    }));
    return [...rows, blankMaterial()];
  });
  const [prodLines, setProdLines] = useState<ProductLine[]>(() => {
    const rows = job.receipts.map<ProductLine>((r) => ({
      ...blankProduct(),
      productId: String(r.product_id),
      variantId: r.variant_id ? String(r.variant_id) : "",
      qty: String(r.qty),
    }));
    return [...rows, blankProduct()];
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!jobDate) { toast("Pick a date", "error"); return; }
    setSaving(true);
    try {
      await api(`/jobs/${job.id}`, {
        method: "PATCH",
        body: {
          job_date: jobDate,
          expected_note: expected.trim() || null,
          notes: notes.trim() || null,
          issues: materialPayload(matLines),
          receipts: productPayload(prodLines),
        },
      });
      onDone("Job updated");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SubForm title="Edit job" onBack={onBack} onSave={save} saving={saving} saveLabel="Save changes">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date">
          <DateField value={jobDate} onChange={setJobDate} max={todayISO()} ariaLabel="Job date" />
        </Field>
        <Field label="What to make">
          <Input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="e.g. 20 ring boxes" />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-semibold text-ink">Material issued</p>
        <p className="text-xs text-muted">Edit, add, or remove the raw material issued for this job.</p>
        <MaterialRows items={items} lines={matLines} setLines={setMatLines} />
      </div>

      <div className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-semibold text-ink">Goods received</p>
        <p className="text-xs text-muted">Edit, add, or remove the finished goods received back.</p>
        <ProductRows products={products} lines={prodLines} setLines={setProdLines} />
      </div>
    </SubForm>
  );
}

function PayView({ job, onBack, onDone }: { job: JobDetail; onBack: () => void; onDone: (m: string) => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!(Number(amount) > 0)) { toast("Enter an amount", "error"); return; }
    setSaving(true);
    try {
      await api("/payments", {
        method: "POST",
        body: {
          party_type: "karigar",
          party_id: job.karigar_id,
          direction: "paid",
          amount: Number(amount),
          ref_note: note || `Job #${job.id} payment`,
        },
      });
      onDone("Payment recorded");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SubForm title="Karigar payment" onBack={onBack} onSave={save} saving={saving} saveLabel="Pay">
      <Field label="Amount"><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus /></Field>
      <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </SubForm>
  );
}

/* ---------------- small helpers ---------------- */

function Section({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {summary && <p className="mb-1.5 text-xs text-muted">{summary}</p>}
      {!summary && <div className="mb-1.5" />}
      {children}
    </div>
  );
}
function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
function MiniTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-muted">
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i === head.length - 1 ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:px-3">{children}</tbody>
      </table>
    </div>
  );
}
function SubForm({
  title, children, onBack, onSave, saving, saveLabel,
}: {
  title: string; children: React.ReactNode; onBack: () => void; onSave: () => void; saving: boolean; saveLabel: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1 self-start text-sm text-muted hover:text-ink">
        <Icon.ArrowLeft /> Back
      </button>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children}
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={onBack}>Cancel</Button>
        <Button onClick={onSave} disabled={saving}>{saving ? <Spinner /> : saveLabel}</Button>
      </div>
    </div>
  );
}
