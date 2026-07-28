export type ClassValue = string | false | null | undefined;

/** Tiny className joiner (no external dep). */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Format a number as Indian rupees, e.g. 48000 -> "₹48,000". */
export function rupees(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Format a numeric quantity, trimming trailing zeros. */
export function qty(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

/** Format an ISO date/timestamp as dd/mm/yyyy. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB");
}

/** Today's date as yyyy-mm-dd (for date inputs). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Display label for a user role. The internal 'owner' role is the full-access role, shown as "Admin". */
export function roleLabel(role: string | undefined | null): string {
  if (!role) return "";
  if (role === "owner") return "Admin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
