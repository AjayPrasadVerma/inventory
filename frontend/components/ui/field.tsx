"use client";

import { cn } from "@/lib/utils";

const inputBase =
  "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-primary";
const invalidRing =
  "border-[color:var(--danger)] focus:border-[color:var(--danger)]";

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

type InvalidProp = { invalid?: boolean; dense?: boolean };

export function Input({ invalid, dense, className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & InvalidProp) {
  return <input {...props} aria-invalid={invalid || undefined} className={cn(inputBase, dense && "h-9", invalid && invalidRing, className)} />;
}

export function Textarea({ invalid, className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<InvalidProp, "dense">) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(inputBase, "h-auto py-2 min-h-20 resize-y", invalid && invalidRing, className)}
    />
  );
}

export function Select({ invalid, dense, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & InvalidProp) {
  return <select {...props} aria-invalid={invalid || undefined} className={cn(inputBase, "pr-8", dense && "h-9", invalid && invalidRing, className)} />;
}

export function Field({
  label,
  children,
  htmlFor,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-[color:var(--danger)]">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}
