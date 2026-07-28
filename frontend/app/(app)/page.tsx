"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { qty as fmtQty } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Badge, Card, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import { Icon } from "@/components/icons";

type Tone = "primary" | "accent" | "success" | "warning" | "danger";
const TINT: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: "var(--primary-tint)", fg: "var(--primary)" },
  accent: { bg: "var(--accent-tint)", fg: "var(--accent)" },
  success: { bg: "var(--success-tint)", fg: "var(--success)" },
  warning: { bg: "var(--warning-tint)", fg: "var(--warning)" },
  danger: { bg: "var(--danger-tint)", fg: "var(--danger)" },
};
const HEALTH = { low: "#e0a03a", oversold: "#e0664f" } as const;
const PALETTE = ["#4f5ac0", "#3aa0c9", "#5bbfa3", "#8b7cd8", "#4fb07f", "#5b8def", "#a06cd0", "#2e9e8f", "#7c9cbf", "#c07fb0"];

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

interface CatDatum { label: string; value: number; fill: string }
interface AttnItem { kind: "Raw" | "Finished"; name: string; sub: string; on_hand: number; status: "Low" | "Oversold" }

const withColor = (rows: CatValue[]): CatDatum[] => rows.map((r, i) => ({ ...r, fill: PALETTE[i % PALETTE.length] }));

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
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

  const finishedTotal = data?.finishedTotal ?? 0;
  const rawLines = useMemo(() => (data?.rawByCategory ?? []).reduce((s, r) => s + r.value, 0), [data]);
  const finishedByCat = useMemo<CatDatum[]>(() => withColor(data?.finishedByCategory ?? []), [data]);
  const rawByCat = useMemo<CatDatum[]>(() => withColor(data?.rawByCategory ?? []), [data]);
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
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`Welcome back, ${user?.name ?? ""}`.trim()} subtitle="Today's activity and stock at a glance." />

      {error && <p className="mb-4 text-sm text-[color:var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <div className="space-y-6">
          {/* Hero KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Hero label="Finished Goods in Stock" value={fmtQty(finishedTotal)} hint={`across ${data?.products ?? 0} products`} icon={<Icon.Product />} tone="primary" href="/reports/finished-stock" />
            <Hero label="Raw Materials" value={data?.rawMaterials ?? 0} hint={`${rawLines} stock lines`} icon={<Icon.Item />} tone="accent" href="/reports/raw-stock" />
            <Hero label="Low / Oversold Stock" value={data?.lowStockCount ?? 0} hint={data && data.lowStockCount > 0 ? "Needs restocking" : "All healthy"} icon={<Icon.Report />} tone={data && data.lowStockCount > 0 ? "danger" : "success"} href="/reports/low-stock" />
            <Hero label="Open Jobs" value={data?.openJobs ?? 0} hint="Material out with karigars" icon={<Icon.Job />} tone="warning" href="/jobs" />
          </div>

          {/* Category overview */}
          <div className="grid gap-4 lg:grid-cols-2">
            <CategoryChart title="Finished Goods by Category" subtitle="Pieces on hand" unit="pcs" href="/reports/finished-stock" data={finishedByCat} />
            <CategoryChart title="Raw Materials by Category" subtitle="Stock lines per category" unit="lines" href="/reports/raw-stock" data={rawByCat} />
          </div>

          {/* Needs attention — the actionable list */}
          <AttentionList items={attention} />

          {/* Today */}
          <div>
            <SectionTitle>Today</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <Mini label="Purchases" value={data?.purchasesToday ?? 0} hint="Recorded" icon={<Icon.Purchase />} tone="primary" href="/purchases" />
              <Mini label="Sales" value={data?.salesToday ?? 0} hint="Billed" icon={<Icon.Sale />} tone="success" href="/sales" />
              <Mini label="Material Issued" value={data?.issuesToday ?? 0} hint="To karigars" icon={<Icon.Karigar />} tone="warning" href="/reports/karigar-issued" />
            </div>
          </div>

          {/* Quick actions */}
          <div>
            <SectionTitle>Quick actions</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-3">
              <QuickLink href="/sales" title="New Sale" hint="Bill a customer" icon={<Icon.Sale />} tone="success" />
              <QuickLink href="/purchases" title="New Purchase" hint="Record raw material from a vendor" icon={<Icon.Purchase />} tone="primary" />
              <QuickLink href="/jobs" title="New Job" hint="Issue material to a karigar" icon={<Icon.Job />} tone="warning" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CatTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: CatDatum }[]; unit?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow-md)]">
      <p className="font-semibold text-ink">{d.label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-ink">
        {fmtQty(d.value)} <span className="text-xs font-normal text-muted">{unit}</span>
      </p>
    </div>
  );
}

/** Keep the chart readable with any number of categories: top N + an "Others" bucket. */
function capCategories(data: CatDatum[], n = 8): CatDatum[] {
  if (data.length <= n + 1) return data;
  const top = data.slice(0, n);
  const rest = data.slice(n).reduce((s, d) => s + d.value, 0);
  return [...top, { label: "Others", value: rest, fill: "#9aa0b8" }];
}

function CategoryChart({ title, subtitle, unit, href, data }: { title: string; subtitle: string; unit: string; href: string; data: CatDatum[] }) {
  const shown = capCategories(data);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs text-muted">{subtitle}{data.length > shown.length ? ` · top ${shown.length - 1} shown` : ""}</p>
        </div>
        <Link href={href} className="shrink-0 text-xs font-medium text-primary hover:underline">View all →</Link>
      </div>
      {data.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No stock recorded yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={shown} margin={{ top: 20, right: 8, bottom: 4, left: 0 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              angle={shown.length > 5 ? -30 : 0}
              textAnchor={shown.length > 5 ? "end" : "middle"}
              height={shown.length > 5 ? 64 : 30}
              tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
            />
            <YAxis width={40} tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} />
            <Tooltip content={<CatTooltip unit={unit} />} cursor={{ fill: "var(--surface-2)", opacity: 0.5 }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={64} isAnimationActive={false}>
              {shown.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
              <LabelList dataKey="value" position="top" style={{ fontSize: 12, fontWeight: 700, fill: "var(--ink)" }} formatter={(v: unknown) => fmtQty(Number(v))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
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
    <Link href={href} className="group relative overflow-hidden rounded-2xl border border-border p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]" style={{ background: c.bg }}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: c.fg }}>{label}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: c.fg }}>{icon}</span>
      </div>
    </Link>
  );
}

function Mini({ label, value, hint, icon, tone, href }: { label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tone: Tone; href: string }) {
  const c = TINT[tone];
  return (
    <Link href={href} className="soft-card flex items-center gap-3 p-3 transition-colors hover:border-border-strong hover:bg-surface-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: c.bg, color: c.fg }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate text-lg font-semibold text-ink">{value}</p>
        {hint && <p className="text-[11px] text-muted">{hint}</p>}
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
