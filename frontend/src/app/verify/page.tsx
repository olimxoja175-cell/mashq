"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/types";
import { Alert, Button } from "@/components/ui";
import { AuthFrame } from "@/components/AuthFrame";

type Challenge = { challenge_id: string; expires_at: string; name: string; dev_code?: string };

export default function VerifyPage() {
  const router = useRouter();
  const { setMe, refresh, t } = useAuth();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem("wv_challenge");
    if (!raw) {
      router.replace("/login");
      return;
    }
    setCh(JSON.parse(raw));
    refs.current[0]?.focus();
  }, [router]);

  useEffect(() => {
    if (!ch) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(ch.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ch]);

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      const all = clean.slice(0, 6).split("");
      setDigits([...all, ...Array(6 - all.length).fill("")]);
      refs.current[Math.min(all.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!ch) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: Me }>("/api/auth/verify", { body: { challenge_id: ch.challenge_id, code: digits.join("") } });
      sessionStorage.removeItem("wv_challenge");
      setMe(r.user);
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
      setDigits(Array(6).fill(""));
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  const complete = digits.every((d) => d);
  return (
    <AuthFrame step={2}>
      <h1 className="font-serif text-2xl text-ivory">{t("identityVerification")}</h1>
      <p className="mt-1 text-sm text-navy-300">
        {ch?.name ? <>Confirm that you are <span className="text-ivory">{ch.name}</span>. </> : null}
        Enter the 6-digit code from your registered authenticator.
      </p>
      <form onSubmit={submit} className="mt-6">
        <div className="flex justify-between gap-2" dir="ltr">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              value={d}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1}`}
              maxLength={6}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => e.key === "Backspace" && !d && i > 0 && refs.current[i - 1]?.focus()}
              className="h-14 w-12 rounded-lg border border-navy-600 bg-navy-900 text-center font-serif text-2xl text-ivory focus:border-gold-500 focus:outline-none"
            />
          ))}
        </div>
        <div className="mt-3 text-xs text-navy-400">
          {left > 0 ? `This verification request expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Request expired — sign in again."}
        </div>
        {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
        {ch?.dev_code && (
          <div className="mt-4">
            <Alert tone="info">
              Development mode: current demo code <button type="button" className="font-mono font-bold underline" onClick={() => setDigit(0, ch.dev_code!)}>{ch.dev_code}</button>. In production this hint does not exist.
            </Alert>
          </div>
        )}
        <Button type="submit" size="lg" className="mt-6 w-full" disabled={!complete || left === 0} loading={busy}>{t("verify")}</Button>
        <button type="button" onClick={() => router.replace("/login")} className="mt-3 w-full text-center text-xs text-navy-300 hover:text-ivory">← Back</button>
      </form>
    </AuthFrame>
  );
}
