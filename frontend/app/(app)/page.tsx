"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { qty as fmtQty } from "@/lib/utils";
import { Badge, Card, Spinner } from "@/components/ui/misc";
import { Icon } from "@/components/icons";
import { DayActivity } from "@/components/day-activity";
import { KarigarEntryModal } from "@/components/karigar-entry-modal";
import { PaymentModal } from "@/components/payment-modal";

type Tone = "primary" | "accent" | "success" | "warning" | "danger" | "info";
const TINT: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: "var(--primary-tint)", fg: "var(--primary)" },
  accent: { bg: "var(--accent-tint)", fg: "var(--accent)" },
  success: { bg: "var(--success-tint)", fg: "var(--success)" },
  warning: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  danger: { bg: "var(--danger-tint)", fg: "var(--danger)" },
  info: { bg: "var(--info-tint)", fg: "var(--info)" },
};
const HEALTH = { low: "#e0a03a", oversold: "#e0664f" } as const;

interface CatValue { label: string; value: number }
interface ServerAttn { kind: "Raw" | "Finished"; name: string; variant: string | null; unit: string | null; on_hand: string; status: "Low" | "Oversold" }
interface Dashboard {
  rawMaterials: number;
  products: number;
  vendors: number;
  karigars: number;
  customers: number;
  openJobs: number;
  purchasesToday: number;
  salesToday: number;
  issuesToday: number;
  lowStockCount: number;
  finishedTotal: number;
  finishedByCategory: CatValue[];
  rawByCategory: CatValue[];
  attention: ServerAttn[];
}

interface AttnItem { kind: "Raw" | "Finished"; name: string; sub: string; on_hand: number; status: "Low" | "Oversold" }


export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  /** Which of the three actions is open. The dashboard has no party in its URL,
   *  so each form asks for one itself rather than putting a dialog in front of
   *  the form the owner actually wanted. */
  const [action, setAction] = useState<"in" | "out" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Single request — the server returns counts, category rollups, and the low/oversold
    // list already computed, so we never download the full stock ledger on the home screen.
    api<{ data: Dashboard }>("/reports/dashboard")
      .then((d) => setData(d.data))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  /** Bumped after a save so the day's feed refetches rather than showing a day
   *  that no longer matches what was just recorded. */
  const [reloadKey, setReloadKey] = useState(0);
  const done = () => { setAction(null); setReloadKey((n) => n + 1); };

  const finishedTotal = data?.finishedTotal ?? 0;
  const rawLines = useMemo(() => (data?.rawByCategory ?? []).reduce((s, r) => s + r.value, 0), [data]);
  const attention = useMemo<AttnItem[]>(
    () =>
      (data?.attention ?? []).map((x) => ({
        kind: x.kind,
        name: x.name,
        sub: [x.variant, x.unit].filter(Boolean).join(" · ") || "—",
        on_hand: Number(x.on_hand),
        status: x.status,
      })),
    [data],
  );

  return (
    <div className="w-full">
      {error && <p className="mb-4 text-sm text-[color:var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <div className="space-y-6">
          {/* Hero KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Hero label="Finished Goods" value={fmtQty(finishedTotal)} hint={`across ${data?.products ?? 0} products`} icon={<Icon.Product />} tone="primary" href="/reports/finished-stock" />
            <Hero label="Raw Materials" value={data?.rawMaterials ?? 0} hint={`${rawLines} stock lines`} icon={<Icon.Item />} tone="accent" href="/reports/raw-stock" />
            <Hero label="Low / Oversold" value={data?.lowStockCount ?? 0} hint={data && data.lowStockCount > 0 ? "Needs restocking" : "All healthy"} icon={<Icon.Report />} tone={data && data.lowStockCount > 0 ? "danger" : "success"} href="/reports/low-stock" />
            <Hero label="Open Jobs" value={data?.openJobs ?? 0} hint="Material out with karigars" icon={<Icon.Job />} tone="info" href="/karigars" />
          </div>

          {/* The same three actions as a khata, so recording something does not
              mean navigating to find the record first. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ActionButton label="In" hint="Goods received from a karigar" head="khata-head-in" onClick={() => setAction("in")} />
            <ActionButton label="Out" hint="Material issued to a karigar" head="khata-head-raw" onClick={() => setAction("out")} />
            <ActionButton label="Pay" hint="Pay a karigar or a vendor" head="khata-head-pay" onClick={() => setAction("pay")} />
          </div>

          {/* What happened on a given day — the detail behind the KPIs above. */}
          <DayActivity key={reloadKey} />

          {/* Needs attention — the actionable list */}
          <AttentionList items={attention} />

          {/* Quick actions */}
          <div>
            <SectionTitle>Quick actions</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickLink href="/vendors" title="New Purchase" hint="Open a vendor and add a purchase" icon={<Icon.Purchase />} tone="primary" />
              <QuickLink href="/karigars" title="Issue Material" hint="Open a karigar and issue material" icon={<Icon.Job />} tone="warning" />
            </div>
          </div>
        </div>
      )}

      {(action === "in" || action === "out") && (
        <KarigarEntryModal
          direction={action}
          onClose={() => setAction(null)}
          onDone={done}
        />
      )}

      {action === "pay" && (
        <PaymentModal onClose={() => setAction(null)} onDone={done} />
      )}
    </div>
  );
}

/** One of the three khata actions, wearing that column's colour. */
function ActionButton({
  label, hint, head, onClick,
}: {
  label: string; hint: string; head: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`${head} flex cursor-pointer items-center gap-3 rounded-xl border border-border-strong px-4 py-3 text-left transition-opacity hover:opacity-90`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface/70 text-lg font-bold">+</span>
      <span className="min-w-0">
        <span className="block text-base font-bold uppercase tracking-[0.06em]">{label}</span>
        <span className="block truncate text-xs font-medium opacity-80">{hint}</span>
      </span>
    </button>
  );
}

function AttentionList({ items }: { items: AttnItem[] }) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">Needs Attention</p>
          <p className="text-xs text-muted">Low or oversold stock — restock these first</p>
        </div>
        {items.length > 0 && (
          <Link href="/reports/low-stock" className="shrink-0 text-xs font-medium text-primary hover:underline">
            View all ({items.length}) →
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">✅ Nothing is low or oversold — stock levels look healthy.</p>
      ) : (
        <div className="max-h-[360px] divide-y divide-border overflow-y-auto">
          {items.map((a, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <Badge tone={a.kind === "Raw" ? "neutral" : "accent"}>{a.kind}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                <p className="truncate text-xs text-muted">{a.sub}</p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums" style={{ color: a.status === "Oversold" ? HEALTH.oversold : HEALTH.low }}>
                {fmtQty(a.on_hand)}
              </span>
              <Badge tone={a.status === "Oversold" ? "danger" : "warning"}>{a.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</h2>;
}

function Hero({ label, value, hint, icon, tone, href }: { label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tone: Tone; href: string }) {
  const c = TINT[tone];
  return (
    <Link href={href} className="soft-card group relative overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]">
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: c.fg }} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">{label}</p>
          <p className="mt-2 text-[30px] font-bold leading-none tracking-tight text-ink">{value}</p>
          {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: c.fg }}>{icon}</span>
      </div>
    </Link>
  );
}

function QuickLink({ href, title, hint, icon, tone }: { href: string; title: string; hint: string; icon: React.ReactNode; tone: Tone }) {
  const c = TINT[tone];
  return (
    <Link href={href} className="soft-card flex items-center gap-3 p-4 transition-colors hover:border-border-strong hover:bg-surface-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: c.bg, color: c.fg }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="truncate text-xs text-muted">{hint}</p>
      </div>
      <span className="ml-auto text-muted">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
      </span>
    </Link>
  );
}
