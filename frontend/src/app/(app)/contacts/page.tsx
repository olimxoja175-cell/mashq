"use client";

import { useEffect, useState } from "react";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Contact, UserCard } from "@/lib/types";
import { Alert, Badge, Button, Card, Empty, OfficialLine, PageHeader, Toggle, inputCls } from "@/components/ui";

export default function Contacts() {
  const { t, can, langName } = useAuth();
  const contacts = useApi<Contact[]>("/api/contacts");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserCard[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      api<UserCard[]>(`/api/directory?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const known = new Set(contacts.data?.map((c) => c.user.id));

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      contacts.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader title={t("contacts")} subtitle="Only authorized contacts can be invited to your meetings. Revoking authorization takes effect immediately." />
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title={`${t("contacts")} (${contacts.data?.length ?? 0})`} className="lg:col-span-3">
          {contacts.data?.length === 0 ? <Empty>{t("noItems")}</Empty> : (
            <ul className="divide-y divide-navy-700">
              {contacts.data?.map((c) => (
                <li key={c.id} className="py-3">
                  <OfficialLine u={c.user} extra={c.authorized ? <Badge tone="success">Authorized</Badge> : <Badge tone="danger">Suspended</Badge>} />
                  <div className="mt-2 flex flex-wrap items-center gap-4 ps-[52px] text-xs text-navy-400">
                    <span>Speaks {langName(c.user.language)}</span>
                    <span>Added {fmtDate(c.created_at, { timeStyle: undefined })}</span>
                    <div className="ms-auto flex items-center gap-3">
                      <div className="w-44"><Toggle label="Authorized" checked={c.authorized} onChange={(v) => run(() => api(`/api/contacts/${c.id}`, { method: "PATCH", body: { authorized: v } }))} /></div>
                      <Button size="sm" variant="ghost" onClick={() => run(() => api(`/api/contacts/${c.id}`, { method: "DELETE" }))}>Remove</Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Verified officials directory" className="lg:col-span-2">
          <input className={inputCls} placeholder="Search by name, position or country code" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="mt-4 space-y-3">
            {results.map((u) => (
              <li key={u.id} className="rounded-lg border border-navy-700 p-3">
                <OfficialLine
                  u={u}
                  extra={known.has(u.id) ? <Badge>In contacts</Badge> : can("contacts.manage") ? (
                    <Button size="sm" variant="outline" onClick={() => run(() => api("/api/contacts", { body: { user_id: u.id } }))}>Add</Button>
                  ) : null}
                />
              </li>
            ))}
            {results.length === 0 && <Empty>No verified officials match.</Empty>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
