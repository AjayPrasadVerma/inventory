"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { cn, roleLabel } from "@/lib/utils";
import { Icon } from "./icons";
import { UserMenu } from "./user-menu";
import { CommandPalette, SearchTrigger } from "./command-palette";

type NavItem = { href: string; label: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactNode };

// Flat top-navbar menu. Inventory-only for now: Customers and Sale are hidden until
// billing is in scope (their pages still exist). Purchases live inside a vendor's
// khata and karigar jobs inside a karigar's khata, so neither needs a menu entry.
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: Icon.Dashboard },
  { href: "/vendors", label: "Vendors", icon: Icon.Vendor },
  { href: "/karigars", label: "Karigars", icon: Icon.Karigar },
  // Raw material and finished goods share one list — see app/(app)/products/page.tsx.
  { href: "/products", label: "Products", icon: Icon.Product },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  // The dashboard has no PageHeader, so its slot bar would just be an empty strip.
  const showPageBar = pathname !== "/";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top navbar. Dark so it anchors the page: this and the page bar below used
          to be two white strips separated by a 1px line, which read as one washed
          block 120px tall. */}
      <header className="z-30 flex h-[60px] shrink-0 items-center gap-2 border-b border-white/10 bg-nav px-3 sm:px-5">
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Menu"
        >
          <Icon.Menu />
        </button>

        <Link href="/" className="mr-2 flex shrink-0 items-center" aria-label="Acronix — Diamond Box Wala">
          <Brand reverse />
        </Link>

        {/* Desktop nav — scrolls horizontally as a safety if it ever overflows */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto lg:flex">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SearchTrigger />
          <UserMenu name={user?.name} role={user?.role} onLogout={logout} />
        </div>
      </header>

      {/* Slim page bar — PageHeader portals its title/actions in here */}
      {showPageBar && (
        <div className="z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 py-2 sm:h-14 sm:flex-nowrap sm:px-4 sm:py-0 lg:px-5">
          <div id="topbar-title" className="min-w-0 flex-1" />
          <div id="topbar-actions" className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-none sm:flex-nowrap sm:shrink-0" />
        </div>
      )}

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-nav">
            <div className="flex h-[60px] shrink-0 items-center border-b border-white/10 px-5">
              <Brand reverse />
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
                      active ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <ItemIcon className={cn("h-[18px] w-[18px]", active ? "text-white" : "text-white/60 group-hover:text-white")} />
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

      <CommandPalette />
    </div>
  );
}

function Brand({ reverse }: { reverse?: boolean }) {
  return (
    <span className="flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/acronix-logo.png"
        alt="Acronix"
        width={1008}
        height={307}
        className={cn("h-[24px] w-auto", reverse && "brand-reverse")}
      />
    </span>
  );
}

function UserCard({ name, role, onLogout }: { name?: string; role?: string; onLogout: () => void }) {
  const initials = (name ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="shrink-0 border-t border-white/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15 text-[10px] font-semibold text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white" title={roleLabel(role)}>{name}</span>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Logout"
          className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon.Logout />
        </button>
      </div>
    </div>
  );
}
