"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Invitation } from "@/lib/types";
import { Alert, Button, Card, Empty, OfficialLine, PageHeader, SecurityLevel, StatusBadge, cx } from "@/components/ui";

export default function InvitationsPage() {
  const { t } = useAuth();
  const router = useRouter();
  const inv = useApi<{ incoming: Invitation[]; sent: Invitation[] }>("/api/invitations");
  const [tab, setTab] = useState<"incoming" | "sent">("incoming");
  const [error, setError] = useState("");

  async function act(id: string, action: "accept" | "decline" | "revoke") {
    setError("");
    try {
      const r = await api<{ meeting_id?: string; status?: string }>(`/api/invitations/${id}/${action}`, { method: "POST" });
      if (action === "accept" && r.meeting_id) {
        inv.reload();
        return r.meeting_id;
      }
      inv.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }

  const list = inv.data?.[tab] || [];
  return (
    <div>
      <PageHeader title={t("invitations")} subtitle="Invitations are bound to your verified identity and cannot be forwarded." />
      <div className="mb-4 inline-flex rounded-lg border border-navy-700 p-1">
        {(["incoming", "sent"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cx("rounded-md px-4 py-1.5 text-sm", tab === k ? "bg-gold-500 text-navy-950" : "text-ivory/70")}>
            {k === "incoming" ? "Received" : "Sent"} ({inv.data?.[k].length ?? 0})
          </button>
        ))}
      </div>
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
      <Card>
        {list.length === 0 ? <Empty>{t("noItems")}</Empty> : (
          <ul className="divide-y divide-navy-700">
            {list.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-4 py-4">
                <div className="min-w-[260px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ivory">{i.meeting.title}</span>
                    <StatusBadge status={i.status} />
                    <SecurityLevel level={i.meeting.security_level} />
                  </div>
                  <div className="mt-1 text-xs text-navy-300">
                    {i.meeting.scheduled_start ? `Scheduled ${fmtDate(i.meeting.scheduled_start)}` : "Unscheduled"} · invited {fmtDate(i.created_at)} · expires {fmtDate(i.expires_at)}
                  </div>
                  {i.message && <p className="mt-2 text-sm italic text-ivory/80">“{i.message}”</p>}
                </div>
                <div className="w-72"><OfficialLine u={tab === "incoming" ? i.inviter : i.invitee} /></div>
                <div className="flex gap-2">
                  {tab === "incoming" && i.status === "pending" && (
                    <>
                      <Button size="sm" onClick={async () => { const mid = await act(i.id, "accept"); if (mid && i.meeting.status === "live") router.push(`/meeting/${mid}`); }}>{t("accept")}</Button>
                      <Button size="sm" variant="outline" onClick={() => act(i.id, "decline")}>{t("decline")}</Button>
                    </>
                  )}
                  {tab === "incoming" && i.status === "accepted" && ["live", "scheduled"].includes(i.meeting.status) && (
                    <Button size="sm" onClick={() => router.push(`/meeting/${i.meeting.id}`)}>{t("join")}</Button>
                  )}
                  {tab === "sent" && i.status === "pending" && <Button size="sm" variant="outline" onClick={() => act(i.id, "revoke")}>Revoke</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
