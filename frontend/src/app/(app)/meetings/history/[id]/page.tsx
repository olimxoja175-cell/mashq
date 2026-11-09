"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Meeting, UserCard } from "@/lib/types";
import { Alert, Badge, Card, Empty, Flag, OfficialLine, PageHeader, SecurityLevel, Spinner, StatusBadge } from "@/components/ui";

type Entry = {
  id: string; speaker: UserCard | null; language: string; text: string; confidence: number | null; created_at: string;
  translations: { language: string; text: string; uncertain: boolean; reason: string; provider: string; voice_mode: string; total_ms: number }[];
};

export default function MeetingRecord() {
  const { id } = useParams<{ id: string }>();
  const { langName } = useAuth();
  const rec = useApi<{ meeting: Meeting; entries: Entry[] }>(`/api/meetings/${id}/transcript`);
  if (rec.loading) return <Spinner />;
  if (rec.error) return <Alert tone="danger">{rec.error}</Alert>;
  const m = rec.data!.meeting;
  const durMin = m.started_at && m.ended_at ? Math.round((+new Date(m.ended_at) - +new Date(m.started_at)) / 60000) : null;

  return (
    <div>
      <Link href="/meetings/history" className="text-sm text-gold-400">← Meeting history</Link>
      <PageHeader title={m.title} subtitle={`${fmtDate(m.started_at || m.created_at)}${durMin !== null ? ` · ${durMin} min` : ""}`} action={<div className="flex gap-2"><StatusBadge status={m.status} /><SecurityLevel level={m.security_level} /></div>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Participants">
          <div className="space-y-3">{m.participants.map((p) => <OfficialLine key={p.id} u={p} />)}</div>
        </Card>
        <Card title="Official record" className="lg:col-span-2">
          {rec.data!.entries.length === 0 ? (
            <Empty>No record was kept for this meeting. Records are created only when all participants consent.</Empty>
          ) : (
            <ol className="space-y-5">
              {rec.data!.entries.map((e) => (
                <li key={e.id} className="border-s-2 border-gold-600/50 ps-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-navy-300">
                    <Flag code={e.speaker?.country?.code} /> <span className="text-ivory">{e.speaker?.name}</span>
                    <span>· {new Date(e.created_at).toLocaleTimeString()}</span>
                    <Badge>{langName(e.language)} (original)</Badge>
                  </div>
                  <p className="mt-1 text-ivory">{e.text}</p>
                  {e.translations.map((tr) => (
                    <div key={tr.language} className="mt-2 rounded-md bg-navy-900/70 p-2 text-sm">
                      <div className="mb-0.5 flex flex-wrap gap-2 text-[11px] text-navy-400">
                        <span>{langName(tr.language)}</span><span>· {tr.provider}</span><span>· voice: {tr.voice_mode}</span><span>· {tr.total_ms} ms</span>
                        {tr.uncertain && <Badge tone="warning">uncertain</Badge>}
                      </div>
                      <p className="text-ivory/90">{tr.text}</p>
                      {tr.uncertain && tr.reason && <p className="mt-1 text-xs text-warning">{tr.reason}</p>}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
