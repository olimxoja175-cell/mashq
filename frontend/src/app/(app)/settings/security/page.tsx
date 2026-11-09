"use client";

import { FormEvent, useState } from "react";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { useSettingsForm } from "@/lib/useSettings";
import { Alert, Badge, Button, Card, Field, PageHeader, inputCls } from "@/components/ui";

type Sess = { id: string; ip: string; user_agent: string; created_at: string; last_seen_at: string; expires_at: string; current: boolean };

export default function SecuritySettings() {
  const { t } = useAuth();
  const sessions = useApi<Sess[]>("/api/auth/sessions");
  const f = useSettingsForm();
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [mfa, setMfa] = useState({ password: "", code: "" });
  const [mfaOut, setMfaOut] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [mfaErr, setMfaErr] = useState("");

  async function changePw(e: FormEvent) {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return setPwMsg({ tone: "danger", text: "Passwords do not match" });
    try {
      await api("/api/auth/change-password", { body: { current_password: pw.current_password, new_password: pw.new_password } });
      setPwMsg({ tone: "success", text: "Password changed. All other sessions were signed out." });
      setPw({ current_password: "", new_password: "", confirm: "" });
      sessions.reload();
    } catch (err) {
      setPwMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Failed" });
    }
  }

  async function rotate(e: FormEvent) {
    e.preventDefault();
    setMfaErr("");
    try {
      setMfaOut(await api("/api/auth/mfa/rotate", { body: mfa }));
      setMfa({ password: "", code: "" });
    } catch (err) {
      setMfaErr(err instanceof ApiError ? err.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader title={t("securitySettings")} subtitle="Sessions, credentials and multi-factor authentication. Every change is recorded in the audit log." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Signed-in devices" className="lg:col-span-2">
          <ul className="divide-y divide-navy-700">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ivory">{s.user_agent || "Unknown device"}</div>
                  <div className="text-xs text-navy-400">IP {s.ip} · signed in {fmtDate(s.created_at)} · last active {fmtDate(s.last_seen_at)} · expires {fmtDate(s.expires_at)}</div>
                </div>
                {s.current ? <Badge tone="gold">This device</Badge> : (
                  <Button size="sm" variant="outline" onClick={async () => { await api(`/api/auth/sessions/${s.id}`, { method: "DELETE" }); sessions.reload(); }}>Sign out</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Automatic session expiry">
          <Field label={`Sign out after ${f.value.session_idle_minutes} minutes of inactivity`} hint="Sessions also expire 12 hours after sign-in regardless of activity.">
            <input type="range" min={5} max={120} step={5} value={f.value.session_idle_minutes || 30} onChange={(e) => f.set("session_idle_minutes", +e.target.value)} className="w-full" />
          </Field>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={f.save} disabled={!f.dirty} loading={f.busy}>{t("save")}</Button>
            {f.status && <span className="text-xs text-success">{f.status.text}</span>}
          </div>
        </Card>

        <Card title="Change password">
          <form onSubmit={changePw} className="grid gap-3">
            <Field label="Current password"><input type="password" className={inputCls} value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 12 characters with upper and lower case, a digit and a symbol."><input type="password" className={inputCls} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required autoComplete="new-password" /></Field>
            <Field label="Confirm new password"><input type="password" className={inputCls} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" /></Field>
            {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
            <div><Button type="submit">Change password</Button></div>
          </form>
        </Card>

        <Card title="Authenticator (TOTP)" className="lg:col-span-2">
          <p className="mb-3 text-sm text-navy-300">Re-key your authenticator if your device was lost or replaced. Your current code is required. The new secret is shown once.</p>
          {mfaOut ? (
            <Alert tone="success">
              New secret: <span className="font-mono font-bold">{mfaOut.secret}</span><br />
              Add it to your authenticator app (or use this URI): <span className="break-all font-mono text-xs">{mfaOut.otpauth_uri}</span>
            </Alert>
          ) : (
            <form onSubmit={rotate} className="grid gap-3 md:grid-cols-3">
              <Field label="Password"><input type="password" className={inputCls} value={mfa.password} onChange={(e) => setMfa({ ...mfa, password: e.target.value })} required /></Field>
              <Field label="Current code"><input inputMode="numeric" className={inputCls} value={mfa.code} onChange={(e) => setMfa({ ...mfa, code: e.target.value })} required /></Field>
              <div className="flex items-end"><Button type="submit" variant="outline">Re-key authenticator</Button></div>
              {mfaErr && <div className="md:col-span-3"><Alert tone="danger">{mfaErr}</Alert></div>}
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
