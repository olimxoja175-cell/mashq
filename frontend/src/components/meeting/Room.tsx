"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { flag as rawFlag, supportsFlagEmoji } from "@/lib/i18n";
import { FeedEntry, useMeeting } from "@/lib/meeting/useMeeting";
import { PeerMesh } from "@/lib/meeting/rtc";
import type { Meeting } from "@/lib/types";
import { Badge, Button, cx, inputCls } from "../ui";
import { VideoTile } from "./VideoTile";
import type { LobbyResult } from "./Lobby";

const flag = (c?: string | null) => (supportsFlagEmoji() ? rawFlag(c) : c || "");

const DEMO_HINT: Record<string, string[]> = {
  en: ["Good afternoon, Mr. President.", "Thank you for your warm welcome.", "Let us discuss trade and investment.", "I propose that we sign the agreement on 15 March 2027."],
  uz: ["Xayrli kun, janob Prezident.", "Iliq kutib olganingiz uchun rahmat.", "Keling, savdo va investitsiyalarni muhokama qilaylik.", "Kelishuvni 2027-yil 15-martda imzolashni taklif qilaman."],
  zh: ["下午好，总统先生。", "感谢您的热情欢迎。", "让我们讨论贸易和投资。", "我提议我们于2027年3月15日签署该协议。"],
  ru: ["Добрый день, господин Президент.", "Благодарю вас за тёплый приём.", "Давайте обсудим торговлю и инвестиции."],
  ar: ["مساء الخير، سيادة الرئيس.", "شكرًا لكم على حفاوة الاستقبال.", "دعونا نناقش التجارة والاستثمار."],
  fr: ["Bonjour, Monsieur le Président.", "Merci pour votre accueil chaleureux.", "Discutons du commerce et des investissements."],
};

export function Room({ meeting, lobby }: { meeting: Meeting; lobby: LobbyResult }) {
  const { me, t, languages, langName } = useAuth();
  const router = useRouter();
  const s = me!.settings;
  const [panel, setPanel] = useState<"transcript" | "people" | "settings" | null>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? null : "transcript");
  const [subs, setSubs] = useState(s.subtitles_enabled);
  const [showOriginal, setShowOriginal] = useState(s.show_original_subtitles);
  const [origVol, setOrigVol] = useState(s.original_audio_volume);
  const [typed, setTyped] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const m = useMeeting({
    meetingId: meeting.id, selfId: me!.id, localStream: lobby.stream, spoken: lobby.spoken, listen: lobby.listen,
    aiConsent: lobby.aiConsent, autoDetect: s.auto_detect_language, speechEngine: s.speech_engine,
    originalVolume: s.original_audio_volume, translatedVolume: s.translated_audio_volume, languages,
  });

  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Release camera/microphone only on a real unmount (StrictMode re-mounts must not kill the tracks).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const stream = lobby.stream;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) stream.getTracks().forEach((tr) => tr.stop());
      }, 0);
    };
  }, [lobby.stream]);

  const isHost = meeting.host.id === me!.id;
  const remotes = Object.values(m.remotes);
  const people = new Map<string, { name: string; country: string }>([[me!.id, { name: me!.name, country: me!.country?.code || "" }], ...remotes.map((r) => [r.user_id, { name: r.name, country: r.country }] as const)]);
  const latest = useMemo(() => [...m.feed].reverse().find((e) => !e.mine && (e.translation || e.original)), [m.feed]);
  const bcp = (c: string) => languages.find((l) => l.code === c);
  const rtlFor = (c: string) => !!bcp(c)?.rtl;

  function leave() {
    m.leave();
    router.push("/dashboard");
  }
  async function endMeeting() {
    await api(`/api/meetings/${meeting.id}/end`, { method: "POST" }).catch(() => {});
    m.leave();
    router.push("/meetings/history");
  }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen();
  }

  if (m.conn === "ended" || m.conn === "denied" || (m.conn === "closed" && m.connInfo)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="font-serif text-3xl text-ivory">{m.conn === "ended" ? "The meeting has ended" : m.conn === "denied" ? "Access refused" : "Disconnected"}</div>
        {m.connInfo && <p className="text-navy-300">{m.connInfo}</p>}
        <Button onClick={() => router.push("/dashboard")}>{t("dashboard")}</Button>
      </div>
    );
  }

  const count = remotes.length + 1;
  const grid = count <= 1 ? "grid-cols-1" : count === 2 ? "grid-cols-1 md:grid-cols-2" : count <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 xl:grid-cols-3";

  return (
    <div ref={rootRef} className="flex h-[100dvh] flex-col overflow-hidden bg-navy-950">
      {/* ---------------- top bar ---------------- */}
      <header className="flex flex-wrap items-center gap-2 border-b border-navy-700 px-3 py-2 sm:px-4 sm:py-2.5">
        <span className="hidden font-serif tracking-[0.2em] text-gold-400 sm:inline">WORLDVOICE</span>
        <span className="mx-2 hidden h-5 w-px bg-navy-600 sm:block" />
        <span className="min-w-0 max-w-full truncate font-medium text-ivory sm:max-w-md">{meeting.title}</span>
        <Badge tone={meeting.security_level === "top_secret" ? "danger" : "gold"}>🔒 {meeting.security_level.replace("_", " ")}</Badge>
        <Badge tone="success" className="hidden sm:inline-flex">⛨ {t("e2e")}</Badge>
        {lobby.aiConsent || remotes.some((r) => r.ai_consent) ? (
          <Badge tone="gold"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gold-400" /> {t("aiActive")}</Badge>
        ) : null}
        {m.ai?.development_mode && <Badge tone="warning">{t("devMode")}<span className="hidden sm:inline"> — simulated translation</span></Badge>}
        {m.recording.active && <Badge tone="danger"><span className="pulse-dot h-2 w-2 rounded-full bg-danger" /> {t("recording")}</Badge>}
        <div className="ms-auto flex items-center gap-3 text-xs">
          <ConnBadge conn={m.conn} t={t} />
          {m.latencyEwma !== null && <span className="text-navy-300" title="Average speech-to-interpretation delay">⏱ {(m.latencyEwma / 1000).toFixed(1)} s</span>}
          <span className="font-mono text-navy-300">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>
        </div>
      </header>

      {m.errors.length > 0 && (
        <div className="space-y-1 px-4 pt-2">
          {m.errors.map((e, i) => (
            <div key={i} className="flex items-center justify-between rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
              {e}<button onClick={() => m.dismissError(i)} aria-label="Dismiss">✕</button>
            </div>
          ))}
        </div>
      )}
      {m.recording.consentRequested && (
        <div className="mx-4 mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-danger/50 bg-danger/10 p-3 text-sm">
          <span className="flex-1 text-ivory">The host requests an official encrypted record (original speech and interpretations) of this meeting. It starts only if every participant agrees.</span>
          <Button size="sm" onClick={() => m.consentRecording(true)}>I consent</Button>
          <Button size="sm" variant="outline" onClick={() => m.consentRecording(false)}>Decline</Button>
        </div>
      )}
      {m.recording.note && <div className="mx-4 mt-2 text-xs text-navy-300">{m.recording.note}</div>}

      {/* ---------------- stage ---------------- */}
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col p-2 sm:p-3">
          <div className={cx("grid min-h-0 flex-1 auto-rows-fr gap-2 sm:gap-3", grid)}>
            <VideoTile
              isSelf muted stream={lobby.stream} name={`${me!.name} (${t("you")})`} title={me!.title} country={me!.country?.code || ""}
              micOn={m.mic} camOn={m.cam} speaking={m.selfSpeaking} hand={m.hand} big={count <= 2} aiVoiceLabel={t("aiVoice")}
              langLine={`${t("speaks")} ${langName(m.spoken)} · ${t("youHear")} ${langName(m.listen)}`}
            />
            {remotes.map((r) => (
              <VideoTile
                key={r.user_id} rotateKey={String(r.user_id)} stream={r.stream} name={r.name} title={r.title} country={r.country}
                volume={r.spoken === m.listen ? 1 : origVol}
                micOn={r.mic} camOn={r.cam} speaking={r.speaking} aiSpeaking={r.aiSpeaking} quality={r.quality} hand={r.hand}
                peerState={r.peerState} big={count <= 2} aiVoiceLabel={t("aiVoice")}
                langLine={`${t("speaks")} ${langName(r.spoken)} → ${t("youHear")} ${langName(r.spoken === m.listen ? r.spoken : m.listen)}${r.voice_profile ? " · voice profile" : ""}`}
              />
            ))}
          </div>
          {remotes.length === 0 && <div className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm text-navy-300">{t("waitingOthers")}</div>}

          {/* subtitles */}
          {subs && (m.partial || latest) && (
            <div className="pointer-events-none absolute inset-x-2 bottom-3 flex flex-col items-center gap-1 sm:inset-x-6 sm:bottom-6">
              {latest && <Subtitle e={latest} people={people} showOriginal={showOriginal} rtlFor={rtlFor} uncertainLabel={t("uncertain")} />}
              {m.partial && <div className="rounded-md bg-black/60 px-3 py-1 text-xs text-navy-300">{t("you")}: {m.partial}…</div>}
            </div>
          )}
        </div>

        {/* ---------------- side panel ---------------- */}
        {panel && (
          <aside className="fixed inset-x-0 bottom-0 z-40 flex h-[65dvh] flex-col rounded-t-2xl border-t border-navy-600 bg-navy-900 shadow-2xl md:static md:h-auto md:w-[380px] md:shrink-0 md:rounded-none md:border-s md:border-t-0 md:border-navy-700 md:bg-navy-900/70 md:shadow-none">
            <div className="flex items-stretch border-b border-navy-700 text-sm">
              {(["transcript", "people", "settings"] as const).map((k) => (
                <button key={k} onClick={() => setPanel(k)} className={cx("flex-1 py-2.5", panel === k ? "border-b-2 border-gold-500 text-gold-300" : "text-navy-300")}>
                  {k === "transcript" ? t("transcript") : k === "people" ? `${t("participants")} (${count})` : t("settings")}
                </button>
              ))}
              <button onClick={() => setPanel(null)} aria-label="Close" className="px-4 text-navy-300 md:hidden">✕</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panel === "transcript" && <Transcript feed={m.feed} people={people} rtlFor={rtlFor} langName={langName} />}
              {panel === "people" && (
                <ul className="space-y-3 text-sm">
                  <li className="rounded-lg border border-navy-700 p-3">
                    <div className="text-ivory">{flag(me!.country?.code)} {me!.name} ({t("you")}) {isHost && <Badge tone="gold">{t("host")}</Badge>}</div>
                    <div className="text-xs text-navy-400">{langName(m.spoken)} → {langName(m.listen)} · AI consent {lobby.aiConsent ? "yes" : "no"}</div>
                  </li>
                  {remotes.map((r) => (
                    <li key={r.user_id} className="rounded-lg border border-navy-700 p-3">
                      <div className="text-ivory">{flag(r.country)} {r.name} {r.user_id === meeting.host.id && <Badge tone="gold">{t("host")}</Badge>}</div>
                      <div className="text-xs text-navy-300">{r.title}</div>
                      <div className="mt-1 text-xs text-navy-400">Speaks {langName(r.spoken)} · hears {langName(r.listen)} · {r.mic ? "mic on" : "mic off"} · {r.cam ? "camera on" : "camera off"} · {r.quality}{r.rtt ? ` (${Math.round(r.rtt)} ms)` : ""}</div>
                      <div className="mt-1 flex gap-1">{r.ai_consent ? <Badge tone="gold">AI interpretation</Badge> : <Badge>original only</Badge>}{r.voice_profile && <Badge tone="success">voice profile</Badge>}</div>
                    </li>
                  ))}
                </ul>
              )}
              {panel === "settings" && (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-navy-300">{t("spokenLanguage")}
                      <select className={inputCls} value={m.spoken} onChange={(e) => m.setLanguages(e.target.value, m.listen)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}</select>
                    </label>
                    <label className="text-xs text-navy-300">{t("listenLanguage")}
                      <select className={inputCls} value={m.listen} onChange={(e) => m.setLanguages(m.spoken, e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}</select>
                    </label>
                  </div>
                  <label className="block text-xs text-navy-300">{t("originalVolume")}: {Math.round(origVol * 100)}%
                    <input type="range" min={0} max={1} step={0.05} value={origVol} onChange={(e) => setOrigVol(+e.target.value)} className="w-full" />
                  </label>
                  <label className="flex items-center justify-between text-xs text-navy-300">{t("subtitles")}<input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /></label>
                  <label className="flex items-center justify-between text-xs text-navy-300">{t("original")} subtitles<input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /></label>
                  <label className="flex items-center justify-between text-xs text-navy-300" title={PeerMesh.playoutDelaySupported() ? "" : "Not supported by this browser"}>
                    {t("lipSync")} {m.latencyEwma ? `(${m.latencyEwma} ms)` : ""}
                    <input type="checkbox" disabled={!PeerMesh.playoutDelaySupported()} checked={m.lipSync} onChange={(e) => m.setLipSync(e.target.checked)} />
                  </label>
                  <div className="rounded-lg border border-navy-700 p-3 text-xs text-navy-300">
                    <div>Speech recognition: <span className="text-ivory">{m.engine === "server" ? `server (${m.ai?.stt.provider})` : m.engine === "browser" ? "browser built-in" : lobby.aiConsent ? "unavailable" : "off (no consent)"}</span></div>
                    <div>Translation: <span className="text-ivory">{m.ai?.translation.provider}{m.ai?.translation.simulated ? " (simulated)" : ""}</span></div>
                    <div>Voice: <span className="text-ivory">{m.ai?.tts.provider === "client" ? "browser speech (generic)" : m.ai?.tts.provider}</span></div>
                  </div>
                  <Button size="sm" variant="outline" onClick={m.simulateDrop}>Test network recovery (drop connection)</Button>
                  {isHost && meeting.recording_policy === "all_consent" && (
                    m.recording.active ? <Button size="sm" variant="danger" onClick={m.stopRecording}>Stop official record</Button>
                      : <Button size="sm" variant="outline" onClick={m.requestRecording}>Request official record (all must consent)</Button>
                  )}
                </div>
              )}
            </div>
            {/* typed statement */}
            {lobby.aiConsent && (
              <form className="border-t border-navy-700 p-3" onSubmit={(e) => { e.preventDefault(); m.sendTyped(typed); setTyped(""); }}>
                <div className="flex gap-2">
                  <input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`${t("typeStatement")} (${langName(m.spoken)})`} dir={rtlFor(m.spoken) ? "rtl" : "ltr"} />
                  <Button type="submit" size="md">{t("send")}</Button>
                </div>
                {m.ai?.development_mode && DEMO_HINT[m.spoken] && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {DEMO_HINT[m.spoken].map((p) => (
                      <button type="button" key={p} onClick={() => m.sendTyped(p)} className="rounded border border-navy-600 px-1.5 py-0.5 text-[10px] text-navy-300 hover:border-gold-500" dir={rtlFor(m.spoken) ? "rtl" : "ltr"}>{p}</button>
                    ))}
                  </div>
                )}
              </form>
            )}
          </aside>
        )}
      </div>

      {/* ---------------- controls ---------------- */}
      <footer className="flex flex-wrap items-center justify-center gap-1.5 border-t border-navy-700 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-4 sm:py-3">
        <Ctl on={m.mic} onClick={m.toggleMic} icon={m.mic ? "🎙" : "🔇"} label={t("mic")} danger={!m.mic} />
        <Ctl on={m.cam} onClick={m.toggleCam} icon={m.cam ? "📹" : "🚫"} label={t("camera")} danger={!m.cam} />
        <Ctl on={subs} onClick={() => setSubs(!subs)} icon="CC" label={t("subtitles")} />
        <Ctl on={m.hand} onClick={m.toggleHand} icon="✋" label={t("raiseHand")} />
        <Ctl on={!!panel} onClick={() => setPanel(panel ? null : "transcript")} icon="☰" label={t("transcript")} />
        <span className="hidden sm:contents"><Ctl on={false} onClick={fullscreen} icon="⛶" label={t("fullscreen")} /></span>
        <span className="mx-1 hidden h-8 w-px bg-navy-600 sm:block" />
        <button onClick={leave} className="flex h-12 items-center gap-2 rounded-xl bg-danger px-4 font-semibold text-white hover:brightness-110 sm:h-14 sm:px-5">⏻ {t("leave")}</button>
        {isHost && <button onClick={endMeeting} className="flex h-12 items-center rounded-xl border border-danger px-3 text-sm text-red-300 hover:bg-danger/10 sm:h-14 sm:px-4">{t("endMeeting")}</button>}
      </footer>
    </div>
  );
}

function Ctl({ on, onClick, icon, label, danger }: { on: boolean; onClick: () => void; icon: string; label: string; danger?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={on} aria-label={label} title={label}
      className={cx("flex h-12 min-w-[48px] flex-col items-center justify-center rounded-xl border px-1.5 text-base transition sm:h-14 sm:min-w-[68px] sm:px-2 sm:text-lg",
        danger ? "border-danger/60 bg-danger/15 text-red-200" : on ? "border-gold-600 bg-gold-500/10 text-gold-300" : "border-navy-600 bg-navy-800 text-ivory hover:border-gold-500")}>
      <span className="leading-none">{icon}</span>
      <span className="mt-1 hidden text-[10px] text-navy-300 sm:block">{label}</span>
    </button>
  );
}

function ConnBadge({ conn, t }: { conn: string; t: (k: "connected" | "reconnecting" | "connecting") => string }) {
  if (conn === "connected") return <span className="flex items-center gap-1 text-success"><span className="h-2 w-2 rounded-full bg-success" />{t("connected")}</span>;
  if (conn === "reconnecting") return <span className="flex items-center gap-1 text-warning"><span className="pulse-dot h-2 w-2 rounded-full bg-warning" />{t("reconnecting")}</span>;
  return <span className="flex items-center gap-1 text-navy-300"><span className="pulse-dot h-2 w-2 rounded-full bg-navy-300" />{t("connecting")}</span>;
}

function Subtitle({ e, people, showOriginal, rtlFor, uncertainLabel }: { e: FeedEntry; people: Map<string, { name: string; country: string }>; showOriginal: boolean; rtlFor: (c: string) => boolean; uncertainLabel: string }) {
  const who = people.get(e.speakerId);
  const tr = e.translation;
  const main = tr ? tr.text : e.original.text;
  const lang = tr ? tr.language : e.original.language;
  const uncertain = tr?.uncertain || e.original.uncertain;
  return (
    <div className="max-w-4xl rounded-xl bg-black/75 px-3 py-2 text-center shadow-2xl backdrop-blur sm:px-5 sm:py-3">
      <div className="mb-1 text-xs text-gold-300">{flag(who?.country)} {who?.name}{tr?.voiceMode && tr.voiceMode !== "none" ? " · AI voice" : ""}</div>
      <div className="text-base leading-snug text-white sm:text-xl md:text-2xl" dir={rtlFor(lang) ? "rtl" : "ltr"}>{main}</div>
      {uncertain && (
        <div className="mt-1 text-xs font-semibold text-warning">⚠ {uncertainLabel}{tr?.reasons?.[0] ? ` — ${tr.reasons[0]}` : ""}</div>
      )}
      {(showOriginal || uncertain) && tr && (
        <div className="mt-1 text-sm text-navy-300" dir={rtlFor(e.original.language) ? "rtl" : "ltr"}>{e.original.text}</div>
      )}
    </div>
  );
}

function Transcript({ feed, people, rtlFor, langName }: { feed: FeedEntry[]; people: Map<string, { name: string; country: string }>; rtlFor: (c: string) => boolean; langName: (c: string) => string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // braces matter: newer Chrome returns a Promise from scrollIntoView, which must not become the effect cleanup
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);
  if (!feed.length) return <p className="py-8 text-center text-xs text-navy-400">Speech and interpretations will appear here. Nothing is stored unless every participant consents to an official record.</p>;
  return (
    <ol className="space-y-3">
      {feed.map((e) => {
        const who = people.get(e.speakerId);
        return (
          <li key={e.id} className={cx("rounded-lg border p-2.5", e.mine ? "border-navy-600 bg-navy-800/60" : "border-navy-700")}>
            <div className="flex items-center gap-1.5 text-[11px] text-navy-400">
              <span>{flag(who?.country)}</span><span className="text-ivory/90">{who?.name}</span>
              <span>· {new Date(e.ts).toLocaleTimeString()}</span>
              <span>· {langName(e.original.language)}{e.original.detected ? " (detected)" : ""}</span>
            </div>
            <p className="mt-1 text-sm text-ivory/90" dir={rtlFor(e.original.language) ? "rtl" : "ltr"}>{e.original.text}</p>
            {e.translation && (
              <div className="mt-1.5 border-s-2 border-gold-600/60 ps-2">
                <p className="text-sm text-gold-200" dir={rtlFor(e.translation.language) ? "rtl" : "ltr"}>{e.translation.text}</p>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-navy-400">
                  <span>{langName(e.translation.language)}</span>
                  <span>{e.translation.provider}{e.translation.simulated ? " (simulated)" : ""}</span>
                  <span>voice: {e.translation.voiceMode}</span>
                  <span>{e.translation.clientMs ?? e.translation.latency.total_ms} ms</span>
                </div>
                {e.translation.uncertain && <p className="mt-1 text-[11px] text-warning">⚠ {e.translation.reasons.join(" ")}</p>}
              </div>
            )}
            {e.mine && <p className="mt-1 text-[10px] text-navy-500">Your words as recognised — you never hear your own interpretation.</p>}
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
