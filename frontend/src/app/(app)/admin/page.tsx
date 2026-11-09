"use client";

import { FormEvent, useState } from "react";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { UserCard } from "@/lib/types";
import { Alert, Badge, Button, Card, Field, OfficialLine, PageHeader, inputCls } from "@/components/ui";

type AdminUser = UserCard & { email: string; is_active: boolean; locked: boolean; last_login_at: string | null; created_at: string; active_sessions: number };
type Country = { code: string; name: string; default_language: string };

export default function AdminUsers() {
  useRequireAuth("admin.users");
  const { t, languages, can, me } = useAuth();
  const users = useApi<AdminUser[]>("/api/admin/users");
  const countries = useApi<Country[]>("/api/countries");
  const roles = useApi<{ roles: { id: string; name: string }[] }>(can("admin.access") ? "/api/admin/roles" : null);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", title: "", organization: "", country_code: "UZ", language: "uz", role_id: "diplomat" });
  const [created, setCreated] = useState<{ totp_secret: string; otpauth_uri: string; note?: string } | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  async function run<T>(fn: () => Promise<T>) {
    setError("");
    try {
      const r = await fn();
      users.reload();
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api<{ totp_secret: string; otpauth_uri: string; note: string }>("/api/admin/users", { body: form }));
    if (r) {
      setCreated(r);
      setShow(false);
    }
  }

  const roleOptions = roles.data?.roles || [{ id: "head_of_state", name: "Head of State" }, { id: "diplomat", name: "Diplomat" }, { id: "delegate", name: "Delegate" }, { id: "security_officer", name: "Security officer" }];

  return (
    <div>
      <PageHeader title={t("administration")} subtitle="Identity lifecycle: enrol officials, verify identity, suspend, reset MFA. Administrators cannot read meeting content." action={<Button onClick={() => setShow(!show)}>＋ Enrol official</Button>} />
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
      {created && (
        <div className="mb-4"><Alert tone="success">
          Official enrolled. Authenticator secret (shown once): <span className="font-mono font-bold">{created.totp_secret}</span><br />
          <span className="break-all font-mono text-xs">{created.otpauth_uri}</span><br />{created.note}
          <div className="mt-2"><Button size="sm" variant="outline" onClick={() => setCreated(null)}>I have stored it securely</Button></div>
        </Alert></div>
      )}
      {show && (
        <Card title="Enrol a new official" className="mb-6">
          <form onSubmit={create} className="grid gap-4 md:grid-cols-3">
            <Field label="Full name"><input className={inputCls} required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label="Position"><input className={inputCls} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Office"><input className={inputCls} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
            <Field label="Email"><input type="email" className={inputCls} required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Initial password" hint="12+ chars, mixed case, digit, symbol"><input type="password" className={inputCls} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role">
              <select className={inputCls} value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                {roleOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Country">
              <select className={inputCls} value={form.country_code} onChange={(e) => {
                const c = countries.data?.find((x) => x.code === e.target.value);
                setForm({ ...form, country_code: e.target.value, language: c?.default_language || form.language });
              }}>
                {countries.data?.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Language">
              <select className={inputCls} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><Button type="submit">Enrol</Button></div>
          </form>
        </Card>
      )}
      <Card title={`Officials and staff (${users.data?.length ?? 0})`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-start text-xs uppercase tracking-wider text-navy-400">
              <tr><th className="py-2 text-start">Official</th><th className="text-start">Role</th><th className="text-start">Identity</th><th className="text-start">Status</th><th className="text-start">Last sign-in</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 pe-3"><OfficialLine u={u} /><div className="ps-[52px] text-xs text-navy-400">{u.email}</div></td>
                  <td>
                    {can("admin.access") && u.id !== me?.id ? (
                      <select className="rounded border border-navy-600 bg-navy-900 px-2 py-1 text-xs" value={u.role} onChange={(e) => run(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role_id: e.target.value } }))}>
                        {roleOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : <span className="text-xs capitalize">{u.role.replace(/_/g, " ")}</span>}
                  </td>
                  <td>
                    <button onClick={() => run(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { identity_verified: !u.verified } }))}>
                      {u.verified ? <Badge tone="success">✓ Verified</Badge> : <Badge tone="warning">Verify now</Badge>}
                    </button>
                  </td>
                  <td className="space-x-1">
                    {u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}
                    {u.locked && <Badge tone="warning">Locked</Badge>}
                    <span className="text-xs text-navy-400">{u.active_sessions} session(s)</span>
                  </td>
                  <td className="text-xs text-navy-300">{fmtDate(u.last_login_at)}</td>
                  <td className="space-x-1 text-end whitespace-nowrap">
                    {u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => run(() => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { is_active: !u.is_active } }))}>{u.is_active ? "Suspend" : "Reactivate"}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => run(() => api(`/api/admin/users/${u.id}/revoke-sessions`, { method: "POST" }))}>End sessions</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { const r = await run(() => api<{ totp_secret: string; otpauth_uri: string }>(`/api/admin/users/${u.id}/reset-mfa`, { method: "POST" })); if (r) setCreated(r); }}>Reset MFA</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
