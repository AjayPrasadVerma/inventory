"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn, roleLabel } from "@/lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./icons";
import { UserMenu } from "./user-menu";

const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode }[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: Icon.Dashboard },
    ],
  },
  {
    label: "Masters",
    items: [
      { href: "/vendors", label: "Vendors", icon: Icon.Vendor },
      { href: "/karigars", label: "Karigars", icon: Icon.Karigar },
      { href: "/items", label: "Raw Materials", icon: Icon.Item },
      { href: "/products", label: "Products", icon: Icon.Product },
      { href: "/customers", label: "Customers", icon: Icon.Customer },
    ],
  },
  {
    label: "Transactions",
    items: [
      { href: "/jobs", label: "Karigar Jobs", icon: Icon.Job },
      { href: "/purchases", label: "Purchases", icon: Icon.Purchase },
      { href: "/sales", label: "Sales", icon: Icon.Sale },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/reports/sales", label: "Sales Report", icon: Icon.Sale },
      { href: "/reports/raw-stock", label: "Raw Material Stock", icon: Icon.Item },
      { href: "/reports/finished-stock", label: "Finished Goods Stock", icon: Icon.Product },
      { href: "/reports/raw-by-vendor", label: "Raw Material by Vendor", icon: Icon.Vendor },
      { href: "/reports/karigar-issued", label: "Material to Karigars", icon: Icon.Karigar },
      { href: "/reports/low-stock", label: "Low / Oversold Stock", icon: Icon.Purchase },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted/70">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const ItemIcon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary-tint text-primary"
                      : "text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                  )}
                  <ItemIcon className={cn("h-[18px] w-[18px]", active ? "text-primary" : "text-muted group-hover:text-ink")} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const sidebarInner = (
    <>
      <Brand />
      <div className="flex-1 overflow-y-auto">{nav}</div>
      <UserCard name={user?.name} role={user?.role} onLogout={logout} />
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar — fixed, only its nav scrolls */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
        {sidebarInner}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-sidebar">
            {sidebarInner}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Menu"
          >
            <Icon.Menu />
          </Button>
          {/* Page title portals in here (see PageHeader) */}
          <div id="topbar-title" className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center gap-2">
            {/* Page action buttons portal in here */}
            <div id="topbar-actions" className="flex items-center gap-2" />
            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <UserMenu name={user?.name} role={user?.role} onLogout={logout} />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
      <span
        className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold shadow-sm"
        style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
      >
        DB
      </span>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold text-ink">Diamond Box Wala</p>
        <p className="text-[11px] text-muted">Inventory &amp; Ledger</p>
      </div>
    </div>
  );
}

function UserCard({ name, role, onLogout }: { name?: string; role?: string; onLogout: () => void }) {
  const initials = (name ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="shrink-0 border-t border-border px-3 py-0.5">
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-tint text-[9px] font-semibold text-primary">
          {initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={roleLabel(role)}>{name}</span>
        <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Logout" className="h-6 w-6 shrink-0 text-muted">
          <Icon.Logout />
        </Button>
      </div>
    </div>
  );
}
