"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Meeting } from "@/lib/types";
import { Alert, Badge, Button, Card, Empty, OfficialLine, PageHeader, SecurityLevel, StatusBadge } from "@/components/ui";

export default function Scheduled() {
  const { me, t, can } = useAuth();
  const router = useRouter();
  const list = useApi<Meeting[]>("/api/meetings?scope=upcoming");
  const [error, setError] = useState("");

  async function cancel(id: string) {
    try {
      await api(`/api/meetings/${id}/cancel`, { method: "POST" });
      list.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader title={t("scheduled")} action={can("meeting.create") && <Button onClick={() => router.push("/meetings/new")}>＋ {t("newMeeting")}</Button>} />
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
      {list.data && list.data.length === 0 && <Empty>{t("noItems")}</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {list.data?.map((m) => (
          <Card key={m.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-serif text-lg text-ivory">{m.title}</div>
                <div className="mt-1 text-sm text-gold-300">{fmtDate(m.scheduled_start)}{m.scheduled_end && ` – ${fmtDate(m.scheduled_end, { dateStyle: undefined })}`}</div>
              </div>
              <div className="flex gap-2"><StatusBadge status={m.status} /><SecurityLevel level={m.security_level} /></div>
            </div>
            {m.agenda && <p className="mt-3 line-clamp-3 text-sm text-navy-300">{m.agenda}</p>}
            <div className="mt-4 space-y-3">
              {m.participants.map((p) => <OfficialLine key={p.id} u={p} extra={p.meeting_role === "host" ? <Badge tone="gold">{t("host")}</Badge> : null} />)}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-navy-700 pt-4">
              {m.recording_policy === "all_consent" && <Badge tone="warning">Record allowed with consent</Badge>}
              <div className="ms-auto flex gap-2">
                {m.host.id === me?.id && <Button size="sm" variant="ghost" onClick={() => cancel(m.id)}>{t("cancel")}</Button>}
                <Button size="sm" onClick={() => router.push(`/meeting/${m.id}`)}>{m.status === "live" ? `${t("join")} (live)` : t("joinMeeting")}</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
