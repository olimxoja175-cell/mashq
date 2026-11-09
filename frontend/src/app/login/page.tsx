"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Alert, Button, Field, inputCls } from "@/components/ui";
import { AuthFrame } from "@/components/AuthFrame";

type LoginRes = { challenge_id: string; expires_at: string; name: string; dev_code?: string };

export default function LoginPage() {
  const router = useRouter();
  const { me, t } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(new URLSearchParams(location.search).has("expired"));
  }, []);
  useEffect(() => {
    if (me) router.replace("/dashboard");
  }, [me, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<LoginRes>("/api/auth/login", { body: { email, password } });
      sessionStorage.setItem("wv_challenge", JSON.stringify(r));
      router.push("/verify");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame step={1}>
      <h1 className="font-serif text-2xl text-ivory">{t("signIn")}</h1>
      <p className="mt-1 text-sm text-navy-300">Authorized officials and representatives only. All access is audited.</p>
      {expired && <div className="mt-4"><Alert>Your session expired for security reasons. Please sign in again.</Alert></div>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label={t("email")}>
          <input className={inputCls} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("password")}>
          <input className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Continue to identity verification</Button>
      </form>
      <DemoAccounts onPick={(e) => { setEmail(e); setPassword("WorldVoice#2026"); }} />
    </AuthFrame>
  );
}

function DemoAccounts({ onPick }: { onPick: (email: string) => void }) {
  const [show, setShow] = useState(false);
  const accounts = [
    ["uz.president@demo.worldvoice", "🇺🇿 President (Uzbek)"],
    ["cn.president@demo.worldvoice", "🇨🇳 President (Chinese)"],
    ["gb.pm@demo.worldvoice", "🇬🇧 Prime Minister (English)"],
    ["eg.president@demo.worldvoice", "🇪🇬 President (Arabic, RTL)"],
    ["fr.minister@demo.worldvoice", "🇫🇷 Minister (French)"],
    ["security@demo.worldvoice", "Security officer"],
    ["admin@demo.worldvoice", "Platform administrator"],
  ];
  return (
    <div className="mt-6 border-t border-navy-700 pt-4">
      <button type="button" className="text-xs text-gold-400 hover:underline" onClick={() => setShow(!show)}>
        {show ? "Hide" : "Show"} demonstration accounts (development mode)
      </button>
      {show && (
        <div className="mt-3 grid gap-1.5">
          {accounts.map(([e, label]) => (
            <button key={e} type="button" onClick={() => onPick(e)} className="flex justify-between rounded-md border border-navy-700 px-3 py-2 text-start text-xs text-ivory/80 hover:border-gold-500">
              <span>{label}</span>
              <span className="text-navy-400">{e}</span>
            </button>
          ))}
          <p className="mt-1 text-[11px] text-navy-400">Fictional demo officials. Password: WorldVoice#2026</p>
        </div>
      )}
    </div>
  );
}
