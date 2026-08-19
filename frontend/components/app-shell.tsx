"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn, roleLabel } from "@/lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./icons";
import { UserMenu } from "./user-menu";

type NavItem = { href: string; label: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode };

// Flat top-navbar menu. Inventory-only for now: Customers and Sale are hidden until
// billing is in scope (their pages still exist). Purchases live inside a vendor's
// khata and karigar jobs inside a karigar's khata, so neither needs a menu entry.
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Icon.Dashboard },
  { href: "/vendors", label: "Vendors", icon: Icon.Vendor },
  { href: "/karigars", label: "Karigars", icon: Icon.Karigar },
  { href: "/items", label: "Raw Materials", icon: Icon.Item },
  { href: "/products", label: "Products", icon: Icon.Product },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top navbar: brand + horizontal nav + user menu */}
      <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-5">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Menu"
        >
          <Icon.Menu />
        </Button>

        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Acronix — Diamond Box Wala">
          <Brand />
        </Link>

        {/* Desktop nav — scrolls horizontally as a safety if it ever overflows */}
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary-tint text-primary" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <UserMenu name={user?.name} role={user?.role} onLogout={logout} />
        </div>
      </header>

      {/* Slim page bar — PageHeader portals its title/actions in here */}
      <div className="z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4 lg:px-5">
        <div id="topbar-title" className="min-w-0 flex-1" />
        <div id="topbar-actions" className="flex shrink-0 items-center gap-2" />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-sidebar">
            <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
              <Brand />
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
              {NAV.map((item) => {
                const ItemIcon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-primary-tint text-primary" : "text-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />}
                    <ItemIcon className={cn("h-[18px] w-[18px]", active ? "text-primary" : "text-muted group-hover:text-ink")} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <UserCard name={user?.name} role={user?.role} onLogout={logout} />
          </aside>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-4 lg:px-5">{children}</main>
    </div>
  );
}

function Brand() {
  return (
    <span className="flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/acronix-logo.png" alt="Acronix" width={1008} height={307} className="h-[26px] w-auto" />
    </span>
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
