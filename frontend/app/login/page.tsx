"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(mobile.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span
            className="grid h-9 w-9 place-items-center rounded-lg text-sm font-bold"
            style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
          >
            DB
          </span>
          <div>
            <h1 className="font-semibold text-ink leading-tight">Diamond Box Wala</h1>
            <p className="text-xs text-muted">Inventory &amp; Ledger</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Mobile number">
            <Input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9999999999"
              autoComplete="username"
              inputMode="numeric"
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {error && (
            <p className="text-sm text-[color:var(--danger)]" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? <Spinner /> : "Login"}
          </Button>
        </form>
      </div>
    </div>
  );
}
