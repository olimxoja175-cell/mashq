"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { Meeting } from "@/lib/types";
import { describeVideo, videoConstraints } from "@/lib/media";
import { Alert, Button, Field, OfficialLine, SecurityLevel, Toggle, inputCls } from "../ui";

export type LobbyResult = { stream: MediaStream; spoken: string; listen: string; aiConsent: boolean };

export function Lobby({ meeting, onJoin }: { meeting: Meeting; onJoin: (r: LobbyResult) => void }) {
  const { me, t, languages } = useAuth();
  const s = me!.settings;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [spoken, setSpoken] = useState(s.spoken_language);
  const [listen, setListen] = useState(s.listen_language);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    navigator.mediaDevices
      .getUserMedia({
        audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: s.echo_cancellation, noiseSuppression: s.noise_suppression, autoGainControl: s.auto_gain },
        video: videoConstraints(s.video_quality, camId),
      })
      .then(async (st) => {
        if (cancelled) return st.getTracks().forEach((x) => x.stop());
        setStream((old) => {
          old?.getTracks().forEach((x) => x.stop());
          return st;
        });
        setError("");
        if (videoRef.current) videoRef.current.srcObject = st;
        setDevices(await navigator.mediaDevices.enumerateDevices());
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        ctx.createMediaStreamSource(st).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const loop = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const b of buf) sum += ((b - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch((e) => setError(`Camera or microphone unavailable: ${e.message}. Check browser permissions.`));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
    };
  }, [camId, micId, s.echo_cancellation, s.noise_suppression, s.auto_gain, s.video_quality]);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-navy-700 bg-navy-950">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
          {!stream && !error && <div className="absolute inset-0 flex items-center justify-center text-navy-400">Starting camera…</div>}
          <div className="absolute bottom-3 start-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs">
            🎙 <span className="h-1.5 w-24 overflow-hidden rounded-full bg-navy-600"><span className="block h-full bg-gold-500" style={{ width: `${level * 100}%` }} /></span>
          </div>
          {stream && <div className="absolute bottom-3 end-3 rounded-full bg-black/60 px-3 py-1 text-xs text-navy-200">📷 {describeVideo(stream)}</div>}
        </div>
        {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t("camera")}>
            <select className={inputCls} value={camId} onChange={(e) => setCamId(e.target.value)}>
              <option value="">Default camera</option>
              {devices.filter((d) => d.kind === "videoinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}
            </select>
          </Field>
          <Field label={t("mic")}>
            <select className={inputCls} value={micId} onChange={(e) => setMicId(e.target.value)}>
              <option value="">Default microphone</option>
              {devices.filter((d) => d.kind === "audioinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="panel p-6 lg:col-span-2">
        <div className="mb-1 flex items-center gap-2"><SecurityLevel level={meeting.security_level} /></div>
        <h1 className="font-serif text-2xl text-ivory">{meeting.title}</h1>
        {meeting.agenda && <p className="mt-2 line-clamp-3 text-sm text-navy-300">{meeting.agenda}</p>}
        <div className="mt-4 space-y-2">{meeting.participants.filter((p) => p.id !== me!.id).map((p) => <OfficialLine key={p.id} u={p} />)}</div>
        <div className="gold-rule my-5" />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("spokenLanguage")}>
            <select className={inputCls} value={spoken} onChange={(e) => setSpoken(e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}</select>
          </Field>
          <Field label={t("listenLanguage")}>
            <select className={inputCls} value={listen} onChange={(e) => setListen(e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}</select>
          </Field>
        </div>
        <div className="mt-4 rounded-lg border border-gold-600/40 bg-gold-500/5 p-3">
          <Toggle
            label="Enable AI interpretation of my speech"
            hint="Your speech is sent over TLS to WORLDVOICE's interpretation service, translated for each listener and voiced synthetically (labelled “AI voice”). Video and your original voice stay peer-to-peer. Without consent you can still listen to others."
            checked={consent}
            onChange={setConsent}
          />
        </div>
        <Button size="lg" className="mt-5 w-full" disabled={!stream} onClick={() => stream && onJoin({ stream, spoken, listen, aiConsent: consent })}>{t("joinMeeting")}</Button>
      </div>
    </div>
  );
}
