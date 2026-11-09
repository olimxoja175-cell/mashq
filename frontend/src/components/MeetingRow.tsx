"use client";

import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Meeting } from "@/lib/types";
import { Button, Flag, SecurityLevel, StatusBadge } from "./ui";

export function MeetingRow({ m }: { m: Meeting }) {
  const { t } = useAuth();
  const router = useRouter();
  const open = m.status === "live" || m.status === "scheduled";
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-full truncate font-medium text-ivory sm:w-auto sm:min-w-0 sm:max-w-full">{m.title}</span>
          <StatusBadge status={m.status} />
          <SecurityLevel level={m.security_level} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-navy-300">
          <span>{fmtDate(m.scheduled_start || m.started_at || m.created_at)}</span>
          <span className="flex gap-1">{m.participants.map((p) => <Flag key={p.id} code={p.country?.code} />)}</span>
          {m.live_participants > 0 && <span className="text-success">{m.live_participants} in room</span>}
        </div>
      </div>
      {open ? (
        <Button size="sm" onClick={() => router.push(`/meeting/${m.id}`)}>{t("join")}</Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => router.push(`/meetings/history/${m.id}`)}>Record</Button>
      )}
    </li>
  );
}
