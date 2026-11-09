"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Invitation, Meeting } from "@/lib/types";
import { Badge, Button, Card, Empty, Flag, OfficialLine, PageHeader } from "@/components/ui";
import { MeetingRow } from "@/components/MeetingRow";

export default function Dashboard() {
  const { me, t, can, langName, ai } = useAuth();
  const router = useRouter();
  const upcoming = useApi<Meeting[]>("/api/meetings?scope=upcoming");
  const history = useApi<Meeting[]>("/api/meetings?scope=history");
  const inv = useApi<{ incoming: Invitation[]; sent: Invitation[] }>("/api/invitations");
  const sessions = useApi<{ id: string; current: boolean }[]>("/api/auth/sessions");
  if (!me) return null;

  const pending = inv.data?.incoming.filter((i) => i.status === "pending") || [];

  async function respond(id: string, action: "accept" | "decline") {
    await api(`/api/invitations/${id}/${action}`, { method: "POST" });
    inv.reload();
    upcoming.reload();
  }

  return (
    <div>
      <PageHeader
        title={`${t("welcome")}, ${me.title}`}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        action={can("meeting.create") && <Button size="lg" onClick={() => router.push("/meetings/new")}>＋ {t("startMeeting")}</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold-500 bg-navy-800 text-3xl">
              <Flag code={me.country?.code} className="flex-col !gap-0" />
            </div>
            <div className="min-w-0">
              <div className="font-serif text-xl text-ivory">{me.name}</div>
              <div className="text-sm text-gold-300">{me.title}</div>
              <div className="text-sm text-navy-300">{me.country?.name}</div>
              <div className="mt-2">{me.verified ? <Badge tone="success">✓ {t("verified")}</Badge> : <Badge tone="warning">{t("notVerified")}</Badge>}</div>
            </div>
          </div>
          <div className="gold-rule my-5" />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-navy-400">{t("spokenLanguage")}</dt>
            <dd className="text-ivory">{langName(me.settings.spoken_language)}</dd>
            <dt className="text-navy-400">{t("listenLanguage")}</dt>
            <dd className="text-ivory">{langName(me.settings.listen_language)}</dd>
          </dl>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
            <Link href="/settings/language" className="rounded-lg border border-navy-700 p-3 hover:border-gold-500"><div className="text-lg text-gold-400">文</div>{t("languageSettings")}</Link>
            <Link href="/settings/audio" className="rounded-lg border border-navy-700 p-3 hover:border-gold-500"><div className="text-lg text-gold-400">♪</div>Audio</Link>
            <Link href="/settings/audio#video" className="rounded-lg border border-navy-700 p-3 hover:border-gold-500"><div className="text-lg text-gold-400">▣</div>Video</Link>
          </div>
        </Card>

        <Card title={t("securityStatus")} className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <SecItem ok label="Multi-factor authentication" value="Verified this session (TOTP)" />
            <SecItem ok={me.verified} label="Official identity" value={me.verified ? `Verified ${fmtDate(me.verified_at, { timeStyle: undefined })}` : "Awaiting administrator verification"} />
            <SecItem ok label="Media encryption" value="WebRTC DTLS-SRTP, peer-to-peer" />
            <SecItem ok label="Active sessions" value={`${sessions.data?.length ?? "…"} signed-in device(s)`} href="/settings/security" />
            <SecItem ok={!ai?.development_mode} warn={ai?.development_mode} label="AI translation" value={ai ? (ai.development_mode ? "Development phrase table (simulated)" : ai.translation.provider) : "…"} />
            <SecItem ok label="Last sign-in" value={fmtDate(me.last_login_at)} />
          </div>
        </Card>

        <Card title={`${t("incoming")} (${pending.length})`} action={<Link className="text-xs text-gold-400" href="/invitations">View all →</Link>} className="lg:col-span-1">
          {pending.length === 0 ? <Empty>{t("noItems")}</Empty> : (
            <ul className="space-y-4">
              {pending.slice(0, 4).map((i) => (
                <li key={i.id} className="rounded-lg border border-navy-700 p-3">
                  <div className="mb-2 text-sm font-medium text-ivory">{i.meeting.title}</div>
                  <OfficialLine u={i.inviter} />
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => respond(i.id, "accept")}>{t("accept")}</Button>
                    <Button size="sm" variant="outline" onClick={() => respond(i.id, "decline")}>{t("decline")}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("scheduled")} action={<Link className="text-xs text-gold-400" href="/meetings/scheduled">View all →</Link>} className="lg:col-span-2">
          {!upcoming.data?.length ? <Empty>{t("noItems")}</Empty> : (
            <ul className="divide-y divide-navy-700">
              {upcoming.data.slice(0, 5).map((m) => <MeetingRow key={m.id} m={m} />)}
            </ul>
          )}
        </Card>

        <Card title={t("recentMeetings")} className="lg:col-span-3" action={<Link className="text-xs text-gold-400" href="/meetings/history">View all →</Link>}>
          {!history.data?.length ? <Empty>{t("noItems")}</Empty> : (
            <ul className="divide-y divide-navy-700">
              {history.data.slice(0, 5).map((m) => <MeetingRow key={m.id} m={m} />)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function SecItem({ ok, warn, label, value, href }: { ok?: boolean; warn?: boolean; label: string; value: string; href?: string }) {
  const body = (
    <div className="flex items-start gap-3 rounded-lg border border-navy-700 p-3">
      <span className={warn ? "text-warning" : ok ? "text-success" : "text-warning"}>{warn || !ok ? "!" : "✓"}</span>
      <div>
        <div className="text-xs uppercase tracking-wider text-navy-400">{label}</div>
        <div className="text-sm text-ivory">{value}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
