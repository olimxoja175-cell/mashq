"use client";

import { Fragment, useEffect, useState } from "react";
import { fmtDate } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { Alert, Badge, Card, PageHeader, SecurityLevel } from "@/components/ui";

type Pct = { count: number; avg: number | null; p50: number | null; p95: number | null };
type Mon = {
  time: string; dev_mode: boolean;
  database: { ok: boolean; latency_ms: number; backend: string };
  redis: { configured: boolean };
  realtime: { rooms: number; connections: number; uptime_s: number };
  live_rooms: { meeting_id: string; title: string; participants: number; security_level: string; recording_active: boolean }[];
  ai: { stt: { provider: string; server_available: boolean }; translation: { provider: string; simulated: boolean }; tts: { provider: string; voice_cloning: boolean } };
  latency: { stt_ms: Pct; mt_ms: Pct; tts_ms: Pct; total_ms: Pct; uncertain_rate: number | null; counters: Record<string, number>; recent_errors: { t: number; kind: string; message: string }[] };
  security: { failed_auth_events: number; access_denied_events: number; critical_events: number };
  counts: Record<string, number>;
  webrtc: { stun: boolean; turn: boolean; max_mesh_participants: number };
};
type Audit = { chain_valid: boolean; checked: number; events: { id: number; type: string; severity: string; user_id: string | null; ip: string; details: Record<string, unknown>; created_at: string; hash: string }[] };

export default function Monitoring() {
  useRequireAuth("system.monitor");
  const { t, can } = useAuth();
  const mon = useApi<Mon>("/api/admin/monitoring");
  const reloadMon = mon.reload;
  const audit = useApi<Audit>(can("audit.read") ? "/api/admin/audit?limit=100" : null);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => reloadMon(), 5000);
    return () => clearInterval(id);
  }, [auto, reloadMon]);

  const m = mon.data;
  return (
    <div>
      <PageHeader title={t("monitoring")} subtitle={m ? `Updated ${fmtDate(m.time)}` : ""} action={
        <label className="flex items-center gap-2 text-sm text-navy-300"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh (5 s)</label>
      } />
      {m && (
        <div className="grid gap-6">
          {m.dev_mode && <Alert>Development mode is ON: demo accounts and MFA hints are enabled; translation is {m.ai.translation.simulated ? "SIMULATED (phrase table)" : "live"}.</Alert>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Live rooms" value={m.realtime.rooms} sub={`${m.realtime.connections} connections`} />
            <Stat label="Database" value={m.database.ok ? "Healthy" : "DOWN"} sub={`${m.database.backend} · ${m.database.latency_ms} ms`} tone={m.database.ok ? "ok" : "bad"} />
            <Stat label="End-to-end interpretation" value={m.latency.total_ms.p50 !== null ? `${m.latency.total_ms.p50} ms` : "—"} sub={`p95 ${m.latency.total_ms.p95 ?? "—"} ms · ${m.latency.total_ms.count} samples (1 h)`} />
            <Stat label="Uncertain translations" value={m.latency.uncertain_rate !== null ? `${Math.round(m.latency.uncertain_rate * 100)}%` : "—"} sub="flagged to listeners" tone={m.latency.uncertain_rate && m.latency.uncertain_rate > 0.2 ? "warn" : "ok"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="AI pipeline">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-navy-400"><tr><th className="py-1 text-start">Stage</th><th className="text-start">Provider</th><th>p50</th><th>p95</th><th>n</th></tr></thead>
                <tbody className="divide-y divide-navy-700">
                  <Row stage="Speech recognition" prov={m.ai.stt.server_available ? m.ai.stt.provider : "browser (client)"} p={m.latency.stt_ms} />
                  <Row stage="Translation" prov={m.ai.translation.provider + (m.ai.translation.simulated ? " (simulated)" : "")} p={m.latency.mt_ms} />
                  <Row stage="Speech synthesis" prov={m.ai.tts.provider + (m.ai.tts.voice_cloning ? " (voice profiles)" : "")} p={m.latency.tts_ms} />
                  <Row stage="Total (server)" prov="" p={m.latency.total_ms} />
                </tbody>
              </table>
              <p className="mt-3 text-xs text-navy-400">Server-side timings. Client playback and network add to the perceived delay; the meeting screen shows per-utterance end-to-end latency.</p>
            </Card>
            <Card title="Infrastructure">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-navy-400">Redis</dt><dd>{m.redis.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">in-process fallback</Badge>}</dd>
                <dt className="text-navy-400">STUN</dt><dd>{m.webrtc.stun ? <Badge tone="success">configured</Badge> : <Badge>none (LAN only)</Badge>}</dd>
                <dt className="text-navy-400">TURN relay</dt><dd>{m.webrtc.turn ? <Badge tone="success">configured</Badge> : <Badge tone="warning">not configured</Badge>}</dd>
                <dt className="text-navy-400">Mesh limit</dt><dd>{m.webrtc.max_mesh_participants} participants</dd>
                <dt className="text-navy-400">Uptime</dt><dd>{Math.floor(m.realtime.uptime_s / 3600)} h {Math.floor((m.realtime.uptime_s % 3600) / 60)} min</dd>
                {Object.entries(m.counts).map(([k, v]) => (<Fragment key={k}><dt className="capitalize text-navy-400">{k.replace(/_/g, " ")}</dt><dd>{v}</dd></Fragment>))}
              </dl>
            </Card>
            <Card title="Live rooms">
              {m.live_rooms.length === 0 ? <p className="text-sm text-navy-400">No live meetings.</p> : (
                <ul className="space-y-2 text-sm">{m.live_rooms.map((r) => (
                  <li key={r.meeting_id} className="flex items-center gap-2"><span className="pulse-dot h-2 w-2 rounded-full bg-success" /><span className="flex-1 truncate">{r.title}</span><SecurityLevel level={r.security_level} /><Badge>{r.participants}</Badge>{r.recording_active && <Badge tone="danger">record</Badge>}</li>
                ))}</ul>
              )}
            </Card>
            <Card title="Security signals">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-navy-400">Failed authentications</dt><dd>{m.security.failed_auth_events}</dd>
                <dt className="text-navy-400">Access denied</dt><dd>{m.security.access_denied_events}</dd>
                <dt className="text-navy-400">Critical events</dt><dd>{m.security.critical_events}</dd>
                {Object.entries(m.latency.counters).map(([k, v]) => (<Fragment key={k}><dt className="font-mono text-xs text-navy-400">{k}</dt><dd>{v}</dd></Fragment>))}
              </dl>
              {m.latency.recent_errors.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-warning">{m.latency.recent_errors.slice(-5).map((e, i) => <li key={i}>{new Date(e.t * 1000).toLocaleTimeString()} {e.kind}: {e.message}</li>)}</ul>
              )}
            </Card>
          </div>

          {audit.data && (
            <Card title="Audit log" action={audit.data.chain_valid ? <Badge tone="success">Hash chain intact · {audit.data.checked} events</Badge> : <Badge tone="danger">TAMPERING DETECTED</Badge>}>
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-navy-850 text-navy-400"><tr><th className="py-1 text-start">Time</th><th className="text-start">Event</th><th className="text-start">Severity</th><th className="text-start">User</th><th className="text-start">IP</th><th className="text-start">Details</th><th className="text-start">Hash</th></tr></thead>
                  <tbody className="divide-y divide-navy-800">
                    {audit.data.events.map((e) => (
                      <tr key={e.id}>
                        <td className="py-1 pe-2 whitespace-nowrap text-navy-300">{fmtDate(e.created_at)}</td>
                        <td className="pe-2 font-mono text-gold-300">{e.type}</td>
                        <td className="pe-2">{e.severity === "critical" ? <Badge tone="danger">critical</Badge> : e.severity === "warning" ? <Badge tone="warning">warning</Badge> : <span className="text-navy-400">info</span>}</td>
                        <td className="pe-2 font-mono text-navy-400">{e.user_id?.slice(0, 8) || "—"}</td>
                        <td className="pe-2 text-navy-400">{e.ip}</td>
                        <td className="max-w-[320px] truncate pe-2 font-mono text-navy-300">{JSON.stringify(e.details)}</td>
                        <td className="font-mono text-navy-500">{e.hash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone = "ok" }: { label: string; value: string | number; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="panel p-5">
      <div className="text-xs uppercase tracking-wider text-navy-400">{label}</div>
      <div className={`mt-1 font-serif text-3xl ${tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : "text-ivory"}`}>{value}</div>
      {sub && <div className="text-xs text-navy-300">{sub}</div>}
    </div>
  );
}

function Row({ stage, prov, p }: { stage: string; prov: string; p: Pct }) {
  return (
    <tr><td className="py-2">{stage}</td><td className="text-xs text-navy-300">{prov}</td><td className="text-center">{p.p50 ?? "—"}</td><td className="text-center">{p.p95 ?? "—"}</td><td className="text-center text-navy-400">{p.count}</td></tr>
  );
}
