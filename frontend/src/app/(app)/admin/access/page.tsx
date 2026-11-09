"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { Alert, Badge, Button, Card, PageHeader, cx } from "@/components/ui";

type Roles = { roles: { id: string; name: string; description: string; users: number; permissions: string[] }[]; permissions: { code: string; description: string }[] };

export default function AccessManagement() {
  useRequireAuth("admin.access");
  const { t } = useAuth();
  const data = useApi<Roles>("/api/admin/roles");
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (data.data) setMatrix(Object.fromEntries(data.data.roles.map((r) => [r.id, new Set(r.permissions)])));
  }, [data.data]);

  function toggle(role: string, perm: string) {
    setMatrix((m) => {
      const s = new Set(m[role]);
      if (s.has(perm)) s.delete(perm);
      else s.add(perm);
      return { ...m, [role]: s };
    });
  }

  async function save(role: string) {
    setMsg(null);
    try {
      await api(`/api/admin/roles/${role}/permissions`, { method: "PUT", body: { permissions: [...matrix[role]] } });
      setMsg({ tone: "success", text: `Permissions for ${role} saved and audited.` });
      data.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Failed" });
    }
  }

  const d = data.data;
  return (
    <div>
      <PageHeader title={t("access")} subtitle="Role-based access control. Changes take effect on the next request and are recorded as critical audit events." />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-navy-400">
                <th className="py-2 text-start">Permission</th>
                {d?.roles.map((r) => (
                  <th key={r.id} className="px-2 text-center">
                    <div className="text-ivory normal-case tracking-normal">{r.name}</div>
                    <div className="font-normal normal-case">{r.users} user(s)</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {d?.permissions.map((p) => (
                <tr key={p.code}>
                  <td className="py-2.5"><div className="font-mono text-xs text-gold-300">{p.code}</div><div className="text-xs text-navy-400">{p.description}</div></td>
                  {d.roles.map((r) => {
                    const on = matrix[r.id]?.has(p.code);
                    return (
                      <td key={r.id} className="text-center">
                        <button aria-label={`${r.id} ${p.code}`} onClick={() => toggle(r.id, p.code)} className={cx("h-6 w-6 rounded border text-xs", on ? "border-gold-500 bg-gold-500 text-navy-950" : "border-navy-600")}>{on ? "✓" : ""}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="py-3 text-xs text-navy-400">Apply changes</td>
                {d?.roles.map((r) => {
                  const changed = d && [...(matrix[r.id] || [])].sort().join() !== [...r.permissions].sort().join();
                  return <td key={r.id} className="text-center">{changed ? <Button size="sm" onClick={() => save(r.id)}>Save</Button> : <Badge>—</Badge>}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-4 text-xs text-navy-400">There is intentionally no permission that grants access to other users&apos; meeting records or voice profiles. Only meeting participants can read a consented record.</p>
    </div>
  );
}
