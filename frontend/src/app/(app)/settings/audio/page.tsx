"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, fmtDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import { useSettingsForm } from "@/lib/useSettings";
import { describeVideo, videoConstraints } from "@/lib/media";
import { Alert, Badge, Button, Card, Field, PageHeader, Toggle, inputCls } from "@/components/ui";

type Voice = {
  status: string; provider?: string; provider_available?: boolean; consent_text: string; consent_signed_name?: string;
  consent_signed_at?: string; sample_seconds?: number; sample_sha256?: string;
};

export default function AudioSettings() {
  const { t, me } = useAuth();
  const f = useSettingsForm();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [camInfo, setCamInfo] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => () => stopTest(), []);
  if (!me) return null;
  const v = f.value;

  async function startTest() {
    setMediaError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: v.echo_cancellation, noiseSuppression: v.noise_suppression, autoGainControl: v.auto_gain },
        video: videoConstraints(v.video_quality),
      });
      streamRef.current = s;
      setCamInfo(describeVideo(s));
      if (videoRef.current) videoRef.current.srcObject = s;
      setDevices(await navigator.mediaDevices.enumerateDevices());
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        if (!streamRef.current) return ctx.close();
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += ((b - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        requestAnimationFrame(loop);
      };
      loop();
      setTesting(true);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Camera/microphone unavailable");
    }
  }

  function stopTest() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTesting(false);
    setLevel(0);
  }

  return (
    <div>
      <PageHeader title={t("audioSettings")} subtitle="Microphone, camera, interpretation audio and your consent-based voice identity." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Device check" action={testing ? <Button size="sm" variant="outline" onClick={stopTest}>Stop</Button> : <Button size="sm" onClick={startTest}>Test camera & microphone</Button>}>
          <div className="aspect-video overflow-hidden rounded-lg border border-navy-700 bg-navy-950">
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-700"><div className="h-full bg-gold-500 transition-[width]" style={{ width: `${level * 100}%` }} /></div>
          {testing && camInfo && <p className="mt-2 text-xs text-navy-300">📷 {camInfo}</p>}
          {mediaError && <div className="mt-3"><Alert tone="danger">{mediaError}</Alert></div>}
          {devices.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-navy-300">
              {devices.filter((d) => d.kind !== "audiooutput").map((d) => <li key={d.deviceId}>{d.kind === "audioinput" ? "🎙" : "📷"} {d.label || d.kind}</li>)}
            </ul>
          )}
        </Card>

        <Card title="Audio processing">
          <Toggle label="Echo cancellation" checked={v.echo_cancellation} onChange={(x) => f.set("echo_cancellation", x)} hint="Prevents translated speech from your speakers being re-captured." />
          <Toggle label="Noise suppression" checked={v.noise_suppression} onChange={(x) => f.set("noise_suppression", x)} />
          <Toggle label="Automatic gain" checked={v.auto_gain} onChange={(x) => f.set("auto_gain", x)} />
          <div className="mt-3 grid gap-4">
            <Field label={`${t("originalVolume")}: ${Math.round(v.original_audio_volume * 100)}%`} hint="Volume of a speaker's original voice while their interpretation plays.">
              <input type="range" min={0} max={1} step={0.05} value={v.original_audio_volume} onChange={(e) => f.set("original_audio_volume", +e.target.value)} className="w-full" />
            </Field>
            <Field label={`Interpretation volume: ${Math.round(v.translated_audio_volume * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={v.translated_audio_volume} onChange={(e) => f.set("translated_audio_volume", +e.target.value)} className="w-full" />
            </Field>
            <Field label="Speech recognition engine" hint="Server: audio segments sent to the configured speech service (with language detection). Browser: the browser's built-in recognition (Chrome sends audio to its vendor's service).">
              <select className={inputCls} value={v.speech_engine} onChange={(e) => f.set("speech_engine", e.target.value as "auto")}>
                <option value="auto">Automatic (server if configured, otherwise browser)</option>
                <option value="server">Server speech recognition</option>
                <option value="browser">Browser speech recognition</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card title="Video" className="scroll-mt-24" >
          <div id="video" />
          <Field label="Sending quality" hint="Automatically reduced when network quality drops.">
            <select className={inputCls} value={v.video_quality} onChange={(e) => f.set("video_quality", e.target.value as "hd")}>
              <option value="sd">Standard (640p)</option>
              <option value="hd">HD (720p)</option>
              <option value="fhd">Full HD (1080p)</option>
            </select>
          </Field>
        </Card>

        <VoiceIdentity />
      </div>
      <div className="mt-6 flex items-center gap-4">
        <Button onClick={f.save} loading={f.busy} disabled={!f.dirty}>{t("save")}</Button>
        {f.status && <Alert tone={f.status.tone}>{f.status.text}</Alert>}
      </div>
    </div>
  );
}

const READING = [
  "Please read this passage aloud in your normal speaking voice.",
  "I take part in international meetings on behalf of my country. My words will be interpreted into many languages, and I want my listeners to recognise my own voice.",
  "Today we discuss cooperation, trade, energy and security, and we look for agreements that benefit our nations and the wider region.",
  "I consent to this recording being used only to create my personal voice profile.",
];

function VoiceIdentity() {
  const { me, can } = useAuth();
  const f = useSettingsForm();
  const voice = useApi<Voice>("/api/voice/profile");
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [signed, setSigned] = useState("");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>(0);

  async function record() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const rec = new MediaRecorder(s);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      s.getTracks().forEach((t) => t.stop());
      setBlob(new Blob(chunks, { type: rec.mimeType }));
    };
    rec.start();
    recRef.current = rec;
    const t0 = Date.now();
    setSeconds(0);
    timer.current = window.setInterval(() => setSeconds((Date.now() - t0) / 1000), 200);
    setRecording(true);
  }
  function stop() {
    recRef.current?.stop();
    clearInterval(timer.current);
    setRecording(false);
  }

  async function enroll() {
    if (!blob) return;
    const fd = new FormData();
    fd.append("consent", String(consent));
    fd.append("signed_name", signed);
    fd.append("sample_seconds", String(Math.round(seconds)));
    fd.append("samples", blob, "voice-sample.webm");
    try {
      await api("/api/voice/enroll", { form: fd });
      setMsg({ tone: "success", text: "Voice profile created." });
      setBlob(null);
      voice.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Enrollment failed" });
    }
  }

  async function revoke() {
    await api("/api/voice/profile", { method: "DELETE" });
    voice.reload();
    setMsg({ tone: "warning", text: "Voice profile revoked and deleted from the provider." });
  }

  const vd = voice.data;
  return (
    <Card title="Voice identity" action={vd && (vd.status === "active" ? <Badge tone="success">Active</Badge> : <Badge>Not enrolled</Badge>)}>
      <p className="text-sm text-navy-300">
        With your consent, interpreted speech can be generated in a voice resembling yours. Your profile is only ever applied to <em>your own</em> words, every synthetic voice is labelled “AI voice” to listeners, and you can revoke it at any time.
      </p>
      <div className="my-3"><Toggle label="Use my voice profile for interpretation" checked={f.value.use_voice_profile} onChange={(x) => { f.set("use_voice_profile", x); }} /></div>
      {f.dirty && <Button size="sm" variant="outline" onClick={f.save}>Save preference</Button>}
      {vd?.status === "active" ? (
        <div className="mt-4 space-y-2 text-sm">
          <div className="text-ivory">Signed by {vd.consent_signed_name} on {fmtDate(vd.consent_signed_at)}</div>
          <div className="text-xs text-navy-400">Provider: {vd.provider} · {vd.sample_seconds}s of speech · sample SHA-256 {vd.sample_sha256?.slice(0, 16)}… (samples are not retained)</div>
          <Button variant="danger" size="sm" onClick={revoke}>Revoke voice profile</Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {vd && !vd.provider_available && (
            <Alert>No voice-cloning provider is connected in this deployment (requires ELEVENLABS_API_KEY). Interpretation uses a generic synthetic voice, clearly labelled.</Alert>
          )}
          {!me?.verified && <Alert>Your identity must be verified by an administrator before voice enrollment.</Alert>}
          <div className="rounded-lg border border-navy-700 bg-navy-900/60 p-3 text-sm leading-relaxed text-ivory/90">
            {READING.map((r, i) => <p key={i} className={i === 0 ? "mb-2 text-xs text-gold-300" : "mb-2"}>{r}</p>)}
          </div>
          <div className="flex items-center gap-3">
            {recording ? <Button variant="danger" onClick={stop}>■ Stop ({seconds.toFixed(0)}s)</Button> : <Button variant="outline" onClick={record} disabled={!can("voice.enroll")}>● Record sample</Button>}
            {blob && !recording && <span className="text-xs text-navy-300">{seconds.toFixed(0)}s recorded {seconds < 30 && "— at least 30 seconds required"}</span>}
          </div>
          <div className="rounded-lg border border-gold-600/40 p-3 text-xs text-ivory/80">{vd?.consent_text}</div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" /> I have read and give this consent.</label>
          <Field label="Signature — type your full official name"><input className={inputCls} value={signed} onChange={(e) => setSigned(e.target.value)} placeholder={me?.name} /></Field>
          <Button onClick={enroll} disabled={!blob || !consent || seconds < 30 || !signed}>Create voice profile</Button>
        </div>
      )}
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Card>
  );
}
