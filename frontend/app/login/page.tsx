"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui/misc";

const ACRONIX = "#1f6fef";

/** Acronix logo — real "A" mark + wordmark. `light` = white text (for the blue panel). */
function AcronixLogo({ size = 30, light = false }: { size?: number; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicon/android-chrome-512x512.png"
        alt="Acronix"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={light ? "rounded-lg bg-white/95 p-1" : ""}
      />
      <span
        className="font-extrabold tracking-tight"
        style={{ color: light ? "#ffffff" : ACRONIX, fontSize: size * 0.82, lineHeight: 1 }}
      >
        Acronix
      </span>
    </span>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
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
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldWrap =
    "flex h-12 items-center rounded-xl border border-border bg-surface transition-colors focus-within:border-[color:var(--acx)] focus-within:ring-[3px] focus-within:ring-[color:var(--acx)]/15";
  const bareInput = "h-full w-full bg-transparent px-3.5 text-sm text-ink placeholder:text-muted outline-none";

  return (
    <div className="grid min-h-screen lg:grid-cols-2" style={{ ["--acx" as string]: ACRONIX }}>
      {/* ── Left: brand panel (hidden on mobile) ── */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
        style={{ background: `linear-gradient(150deg, #2b7bff 0%, ${ACRONIX} 45%, #143c8f 100%)` }}
      >
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/10 blur-3xl" />

        <AcronixLogo size={34} light />

        <div className="relative max-w-md">
          <h2 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.02em] text-white">
            Inventory &amp; Ledger, simplified.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">
            Track raw material and finished stock, manage karigar jobs, purchases and sales — all in one place.
          </p>

          {/* Glass product-preview card */}
          <div className="mt-8 w-full max-w-xs rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">Finished goods in stock</p>
            <p className="mt-1 text-3xl font-bold text-white">2,480<span className="ml-1 text-base font-medium text-white/70">pcs</span></p>
            <div className="mt-3 flex gap-5 text-xs text-white/85">
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-white/80" />128 karigar jobs</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-white/50" />17 low stock</span>
            </div>
          </div>

          <ul className="mt-8 space-y-3.5">
            {["Real-time stock across raw & finished goods", "Karigar jobs, purchases & sales", "Clear reports and one-glance dashboard"].map((t) => (
              <li key={t} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} Acronix. All rights reserved.</p>
      </div>

      {/* ── Right: sign-in form ── */}
      <div className="relative flex flex-col bg-surface px-5 py-8 sm:px-8">
        <div className="m-auto w-full max-w-[400px] acx-fade-up">
          <div className="mb-8 lg:hidden">
            <AcronixLogo size={30} />
          </div>

          <h1 className="text-[28px] font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-2 text-sm text-muted">Welcome back — sign in to continue.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
            <div>
              <label htmlFor="mobile" className="mb-2 block text-sm font-medium text-ink">Mobile number</label>
              <div className={fieldWrap}>
                <span className="grid h-full place-items-center border-r border-border px-3.5 text-sm font-medium text-muted">+91</span>
                <input
                  id="mobile"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="Enter your mobile number"
                  autoComplete="username"
                  inputMode="numeric"
                  autoFocus
                  required
                  className={bareInput}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-ink">Password</label>
                <button type="button" onClick={() => setShowForgot((s) => !s)} className="text-xs font-medium text-[color:var(--acx)] hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className={fieldWrap}>
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  className={bareInput}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
                >
                  {showPw ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" /><path d="m2 2 20 20" /><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" /></svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
              {showForgot && (
                <p className="mt-2 text-xs text-muted">Please contact your administrator to reset your password.</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-[color:var(--danger)] bg-[color:var(--danger-tint)] px-3 py-2.5 text-sm text-[color:var(--danger)]" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white shadow-[0_8px_24px_-6px_rgba(31,111,239,0.45)] transition-all [background-image:linear-gradient(180deg,#2b7bff,#1f6fef)] hover:[background-image:linear-gradient(180deg,#1f6fef,#1657c7)] active:scale-[0.99] disabled:opacity-60"
            >
              {submitting ? <><Spinner /> Signing in…</> : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          Your data is encrypted &amp; private
        </p>
      </div>
    </div>
  );
}
