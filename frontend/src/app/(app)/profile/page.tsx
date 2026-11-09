"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/types";
import { Alert, Badge, Button, Card, Field, Flag, PageHeader, inputCls } from "@/components/ui";

export default function ProfilePage() {
  const { me, setMe, t, langName } = useAuth();
  const [form, setForm] = useState({ full_name: "", title: "", organization: "", bio: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) setForm({ full_name: me.name, title: me.title, organization: me.organization, bio: me.bio });
  }, [me]);
  if (!me) return null;

  const identityChange = form.full_name !== me.name || form.title !== me.title;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api<Me>("/api/profile", { method: "PUT", body: form });
      setMe(updated);
      setMsg(identityChange && me!.verified
        ? { tone: "warning", text: "Saved. Your name or title changed, so identity verification must be renewed by an administrator." }
        : { tone: "success", text: t("saved") });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("profile")} subtitle="Your official identity as presented to other participants." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="text-center">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 border-gold-500 bg-navy-800 font-serif text-3xl text-gold-300">
              {me.name.replace(/\(.*?\)/g, "").split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("")}
            </div>
            <div className="mt-4 font-serif text-xl text-ivory">{me.name}</div>
            <div className="text-gold-300">{me.title}</div>
            <div className="mt-1 flex items-center justify-center gap-2 text-sm text-navy-300"><Flag code={me.country?.code} /> {me.country?.name}</div>
            <div className="mt-3">{me.verified ? <Badge tone="success">✓ {t("verified")}</Badge> : <Badge tone="warning">{t("notVerified")}</Badge>}</div>
          </div>
          <div className="gold-rule my-5" />
          <dl className="space-y-2 text-sm">
            <Row k="Email" v={me.email} />
            <Row k="Role" v={me.role.replace(/_/g, " ")} />
            <Row k="Language" v={langName(me.settings.spoken_language)} />
            <Row k="Verified" v={fmtDate(me.verified_at)} />
            <Row k="Last sign-in" v={fmtDate(me.last_login_at)} />
          </dl>
          <p className="mt-4 text-xs text-navy-400">Country and role are assigned by platform administrators after identity verification.</p>
        </Card>
        <Card title="Official details" className="lg:col-span-2">
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Full official name"><input className={inputCls} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required minLength={2} /></Field>
              <Field label="Official position"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={2} /></Field>
            </div>
            <Field label="Office / organization"><input className={inputCls} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
            <Field label="Biography" hint="Shown to authorized contacts only."><textarea className={inputCls} rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
            {identityChange && me.verified && <Alert>Changing your official name or position removes the verification badge until an administrator re-verifies your identity.</Alert>}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <div><Button type="submit" loading={busy}>{t("save")}</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-navy-400">{k}</dt><dd className="truncate text-end text-ivory capitalize">{v}</dd></div>;
}
