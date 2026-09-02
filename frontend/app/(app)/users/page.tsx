"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Badge, Card, EmptyState, Spinner } from "@/components/ui/misc";
import { PageHeader } from "@/components/page-parts";
import { UserForm, PasswordForm, type AppUser } from "@/components/user-form";
import { Icon } from "@/components/icons";

/**
 * Who can sign in.
 *
 * Owner-only, and gated here as well as on the server: every route this page
 * calls is requireRole('owner'), so for staff the screen would otherwise be a
 * row of error toasts instead of an answer.
 *
 * Removed users stay in the list rather than disappearing. Their mobile number
 * is still taken — it is the login name and the column is unique — so hiding
 * them would leave the owner unable to explain why the number is refused.
 */
export default function UsersPage() {
  const { user: me, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [password, setPassword] = useState<AppUser | null>(null);
  const [access, setAccess] = useState<AppUser | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);

  const isOwner = me?.role === "owner";

  // Deliberately does not raise the spinner again: the first load starts with it
  // up, and a reload after a save has the list already on screen, so flashing it
  // empty would be a step backwards.
  const load = useCallback(() => {
    api<{ users: AppUser[] }>("/auth/users")
      .then((r) => setUsers(r.users))
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  // A shop has a handful of logins, and the endpoint returns them in one go, so
  // the search runs here rather than as another round trip.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.mobile.includes(q));
  }, [users, search]);

  const activeOwners = users.filter((u) => u.role === "owner" && u.is_active).length;

  /** Why this user's access cannot be removed, or null if it can. Mirrors the
   *  server's rules so the button explains itself instead of failing on click. */
  function blockedReason(u: AppUser): string | null {
    if (!u.is_active) return null; // restoring is always allowed
    if (u.id === me?.id) return "You cannot remove your own access";
    if (u.role === "owner" && activeOwners <= 1) return "The only owner left";
    return null;
  }

  async function confirmAccess() {
    if (!access) return;
    setAccessLoading(true);
    try {
      await api(`/auth/users/${access.id}`, { method: "PATCH", body: { is_active: !access.is_active } });
      toast(access.is_active ? `${access.name} can no longer sign in` : `${access.name} can sign in again`, "success");
      setAccess(null);
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAccessLoading(false);
    }
  }

  // Until /auth/me comes back there is no role to judge, and treating that as
  // "not an owner" would flash the refusal at the owner on every reload.
  if (authLoading) {
    return <div className="py-24 text-center"><Spinner className="h-6 w-6 text-primary" /></div>;
  }

  if (!isOwner) {
    return (
      <div className="w-full">
        <PageHeader title="Users" subtitle="Who can sign in" />
        <Card>
          <EmptyState title="Only an owner can manage users" hint="Ask the shop owner to add or change a login." />
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Users"
        subtitle="Who can sign in to this app"
        count={users.length}
        actions={
          <>
            <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none lg:w-80">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name / mobile…"
                aria-label="Search users"
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink shadow-xs outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
            <Button onClick={() => setCreating(true)}>
              <Icon.Plus /> <span className="hidden sm:inline">Add User</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="No users found" hint={search ? "Try a different search." : "Add someone so they can sign in."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table stacked">
              <thead>
                <tr>
                  <th className="w-14 num">S.No.</th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u, i) => {
                  const blocked = blockedReason(u);
                  return (
                    <tr key={u.id} className={u.is_active ? "" : "opacity-60"}>
                      <td data-label="S.No." className="num text-muted">{i + 1}</td>
                      <td className="font-semibold text-ink">
                        {u.name}
                        {u.id === me?.id && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                      </td>
                      <td data-label="Mobile" className="tabular-nums">{u.mobile}</td>
                      <td data-label="Role">
                        <Badge tone={u.role === "owner" ? "accent" : "neutral"}>
                          {u.role === "owner" ? "Owner" : "Staff"}
                        </Badge>
                      </td>
                      <td data-label="Status">
                        {u.is_active
                          ? <Badge tone="success">Active</Badge>
                          : <Badge tone="neutral">Removed</Badge>}
                      </td>
                      <td data-label="Added" className="text-muted">{formatDate(u.created_at)}</td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setEditing(u)} className="inline-flex h-7 cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Edit</button>
                          <button onClick={() => setPassword(u)} className="inline-flex h-7 cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-border-strong">Password</button>
                          <button
                            onClick={() => setAccess(u)}
                            disabled={!!blocked}
                            title={blocked ?? undefined}
                            className="inline-flex h-7 cursor-pointer items-center rounded-md bg-surface-2 px-2.5 text-xs font-medium text-muted transition-colors hover:bg-[color:var(--danger)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-2 disabled:hover:text-muted"
                          >
                            {u.is_active ? "Remove" : "Restore"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(creating || editing) && (
        <UserForm
          user={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
      {password && (
        <PasswordForm user={password} onClose={() => setPassword(null)} onSaved={() => setPassword(null)} />
      )}
      <ConfirmDialog
        open={!!access}
        title={access?.is_active ? "Remove access?" : "Restore access?"}
        message={access?.is_active
          ? <><span className="font-semibold text-ink">{access?.name}</span> will be signed out and will not be able to sign in again. Nothing they have entered is deleted.</>
          : <><span className="font-semibold text-ink">{access?.name}</span> will be able to sign in again with the same password.</>}
        confirmLabel={access?.is_active ? "Remove access" : "Restore"}
        tone={access?.is_active ? "danger" : "primary"}
        loading={accessLoading}
        onConfirm={confirmAccess}
        onClose={() => setAccess(null)}
      />
    </div>
  );
}
