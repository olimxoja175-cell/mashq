"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AIStatus, Language } from "../types";
import { TranslationPlayer } from "./playback";
import { PeerMesh, Quality } from "./rtc";
import { ConnState, MeetingSocket } from "./signaling";
import { blobToBase64, BrowserRecognizer, browserRecognitionSupported, newUtteranceId, ServerSegmenter, Utterance, VoiceActivity } from "./speech";

export type PublicParticipant = {
  user_id: string; name: string; title: string; country: string; role: string;
  spoken: string; listen: string; mic: boolean; cam: boolean; ai_consent: boolean; voice_profile: boolean;
};

export type RemoteState = PublicParticipant & {
  stream?: MediaStream; speaking: boolean; quality: Quality; rtt: number | null;
  aiSpeaking: boolean; peerState: RTCPeerConnectionState | "new"; hand: boolean;
};

export type FeedEntry = {
  id: string; speakerId: string; ts: number; mine: boolean;
  original: { text: string; language: string; uncertain: boolean; confidence: number | null; detected: boolean };
  translation?: {
    text: string; language: string; uncertain: boolean; reasons: string[]; provider: string; simulated: boolean;
    voiceMode: string; latency: { stt_ms: number; mt_ms: number; tts_ms: number; total_ms: number }; clientMs: number | null; failed?: boolean;
  };
};

export type MeetingInfo = { id: string; title: string; host_id: string; security_level: string; recording_policy: string; recording_active: boolean };

type Opts = {
  meetingId: string;
  selfId: string;
  localStream: MediaStream;
  spoken: string;
  listen: string;
  aiConsent: boolean;
  autoDetect: boolean;
  speechEngine: "auto" | "server" | "browser";
  originalVolume: number;
  translatedVolume: number;
  languages: Language[];
};

export function useMeeting(o: Opts) {
  const [conn, setConn] = useState<ConnState>("connecting");
  const [connInfo, setConnInfo] = useState("");
  const [info, setInfo] = useState<MeetingInfo | null>(null);
  const [ai, setAi] = useState<AIStatus | null>(null);
  const [remotes, setRemotes] = useState<Record<string, RemoteState>>({});
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [partial, setPartial] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [hand, setHand] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [spoken, setSpokenState] = useState(o.spoken);
  const [listen, setListenState] = useState(o.listen);
  const [recording, setRecording] = useState<{ active: boolean; consentRequested: boolean; note: string }>({ active: false, consentRequested: false, note: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [lipSync, setLipSync] = useState(PeerMesh.playoutDelaySupported());
  const [latencyEwma, setLatencyEwma] = useState<number | null>(null);
  const [aiPlaying, setAiPlaying] = useState(false);

  const sock = useRef<MeetingSocket | null>(null);
  const mesh = useRef<PeerMesh | null>(null);
  const player = useRef<TranslationPlayer | null>(null);
  const vad = useRef<VoiceActivity | null>(null);
  const seg = useRef<ServerSegmenter | null>(null);
  const rec = useRef<BrowserRecognizer | null>(null);
  const playingUntil = useRef(0);
  const stateRef = useRef({ spoken: o.spoken, listen: o.listen, mic: true });
  const ewmaRef = useRef<number | null>(null);
  const langs = useRef(o.languages);
  useEffect(() => {
    langs.current = o.languages;
  }, [o.languages]);

  const bcp = (code: string) => langs.current.find((l) => l.code === code)?.bcp47 || code;
  const pushError = useCallback((e: string) => setErrors((x) => [...x.slice(-3), e]), []);

  const patchRemote = useCallback((uid: string, patch: Partial<RemoteState>) => {
    setRemotes((r) => (r[uid] ? { ...r, [uid]: { ...r[uid], ...patch } } : r));
  }, []);

  // ------------------------------------------------------------------ outgoing speech
  const sendUtterance = useCallback(async (u: Utterance) => {
    // Feedback guard: never send speech captured while interpreted audio is playing locally.
    if (performance.now() < playingUntil.current) return;
    if (!stateRef.current.mic && !u.text) return;
    if (u.text !== undefined) {
      if (!u.final) return setPartial(u.text);
      setPartial("");
      sock.current?.send({ type: "speech.text", utterance_id: u.id, text: u.text, language: u.language, confidence: u.confidence ?? null, client_ts: Date.now() });
    } else if (u.audio) {
      const data = await blobToBase64(u.audio);
      sock.current?.send({ type: "speech.audio", utterance_id: u.id, mime: u.audio.type, data, client_ts: Date.now() });
    }
  }, []);

  // ------------------------------------------------------------------ incoming messages
  const onMessage = useCallback((m: Record<string, unknown> & { type: string }) => {
    switch (m.type) {
      case "welcome": {
        const parts = m.participants as PublicParticipant[];
        setInfo(m.meeting as MeetingInfo);
        setAi(m.ai as AIStatus);
        setRecording((r) => ({ ...r, active: (m.meeting as MeetingInfo).recording_active }));
        setRemotes((prev) => {
          const next: Record<string, RemoteState> = {};
          for (const p of parts) next[p.user_id] = { ...p, speaking: false, quality: "unknown", rtt: null, aiSpeaking: false, peerState: "new", hand: false, stream: prev[p.user_id]?.stream };
          return next;
        });
        // On (re)connect the newcomer offers a fresh connection to everyone present.
        for (const p of parts) mesh.current?.call(p.user_id);
        break;
      }
      case "participant.joined": {
        const p = m.participant as PublicParticipant;
        setRemotes((r) => ({ ...r, [p.user_id]: { ...p, speaking: false, quality: "unknown", rtt: null, aiSpeaking: false, peerState: "new", hand: false } }));
        // The newcomer will call us; drop any connection from its previous session.
        mesh.current?.remove(p.user_id);
        break;
      }
      case "participant.left":
        mesh.current?.remove(m.user_id as string);
        setRemotes((r) => {
          const n = { ...r };
          delete n[m.user_id as string];
          return n;
        });
        break;
      case "participant.state":
        patchRemote(m.user_id as string, { mic: m.mic as boolean, cam: m.cam as boolean, hand: m.hand as boolean });
        break;
      case "participant.lang":
        if (m.user_id === o.selfId) break;
        patchRemote(m.user_id as string, { spoken: m.spoken as string, listen: m.listen as string });
        break;
      case "speaking":
        patchRemote(m.user_id as string, { speaking: m.active as boolean });
        break;
      case "signal":
        mesh.current?.handleSignal(m.from as string, m.data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; gen?: string; to_gen?: string });
        break;
      case "transcript": {
        const id = m.utterance_id as string;
        const entry: FeedEntry["original"] = { text: m.text as string, language: m.language as string, uncertain: !!m.uncertain, confidence: (m.confidence as number) ?? null, detected: !!m.language_detected };
        setFeed((f) => {
          const i = f.findIndex((e) => e.id === id);
          if (i >= 0) return f.map((e, j) => (j === i ? { ...e, original: entry } : e));
          return [...f.slice(-199), { id, speakerId: m.speaker_id as string, ts: Date.now(), mine: m.speaker_id === o.selfId, original: entry }];
        });
        break;
      }
      case "translation":
      case "translation.failed": {
        const id = m.utterance_id as string;
        const failed = m.type === "translation.failed";
        const clientMs = typeof m.client_ts === "number" ? Date.now() - (m.client_ts as number) : null;
        const lat = (m.latency as NonNullable<FeedEntry["translation"]>["latency"]) || { stt_ms: 0, mt_ms: 0, tts_ms: 0, total_ms: 0 };
        const tr: FeedEntry["translation"] = {
          text: failed ? (m.original_text as string) : (m.text as string), language: m.target_language as string,
          uncertain: failed || !!m.uncertain, reasons: failed ? [m.message as string] : ((m.uncertainty_reasons as string[]) || []),
          provider: (m.provider as string) || "", simulated: !!m.simulated, voiceMode: (m.voice_mode as string) || "none",
          latency: lat, clientMs, failed,
        };
        const speakerId = m.speaker_id as string;
        setFeed((f) => {
          const i = f.findIndex((e) => e.id === id);
          if (i >= 0) return f.map((e, j) => (j === i ? { ...e, translation: tr } : e));
          return [...f.slice(-199), { id, speakerId, ts: Date.now(), mine: false, original: { text: m.original_text as string, language: m.source_language as string, uncertain: false, confidence: null, detected: false }, translation: tr }];
        });
        if (!failed) {
          const total = clientMs ?? lat.total_ms;
          ewmaRef.current = ewmaRef.current === null ? total : ewmaRef.current * 0.7 + total * 0.3;
          setLatencyEwma(Math.round(ewmaRef.current));
          if (m.speak) {
            player.current?.enqueue({
              key: `${id}:${m.target_language}`, speakerId, language: m.target_language as string, bcp47: bcp(m.target_language as string),
              text: m.text as string, audioB64: m.audio as string | null, mime: m.audio_mime as string,
            });
          }
        }
        break;
      }
      case "recording.consent_request":
        setRecording((r) => ({ ...r, consentRequested: true }));
        break;
      case "recording.state":
        setRecording({ active: !!m.active, consentRequested: false, note: m.active ? "" : m.reason === "declined" ? "A participant declined the record." : m.reason === "new_participant" ? "Record paused: a new participant joined." : m.reason === "stopped" ? "Record stopped." : "" });
        break;
      case "meeting.ended":
        setConn("ended");
        break;
      case "error":
        pushError(m.message as string);
        break;
    }
  }, [o.selfId, patchRemote, pushError]);

  // ------------------------------------------------------------------ lifecycle
  useEffect(() => {
    const s = new MeetingSocket(
      o.meetingId,
      () => ({ ai_consent: o.aiConsent, spoken_language: stateRef.current.spoken, listen_language: stateRef.current.listen }),
      onMessage,
      (st, inf) => {
        setConn(st);
        setConnInfo(inf || "");
      },
    );
    sock.current = s;

    mesh.current = new PeerMesh(o.selfId, o.localStream, () => s.iceServers, {
      onSignal: (to, data) => s.send({ type: "signal", to, data }),
      onStream: (uid, stream) => patchRemote(uid, { stream }),
      onPeerState: (uid, peerState) => patchRemote(uid, { peerState }),
      onQuality: (uid, quality, rtt) => patchRemote(uid, { quality, rtt }),
    });

    const pl = new TranslationPlayer(
      (item) => {
        playingUntil.current = Number.POSITIVE_INFINITY;
        setAiPlaying(true);
        patchRemote(item.speakerId, { aiSpeaking: true });
      },
      (item) => {
        playingUntil.current = performance.now() + 350; // tail to avoid capturing the echo
        setAiPlaying(false);
        patchRemote(item.speakerId, { aiSpeaking: false });
      },
    );
    pl.volume = o.translatedVolume;
    player.current = pl;

    s.connect();
    if (process.env.NODE_ENV !== "production") (window as unknown as { __wv: unknown }).__wv = { mesh: mesh.current, sock: s };
    return () => {
      s.close();
      mesh.current?.close();
      pl.stop();
      vad.current?.close();
      seg.current?.close();
      rec.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.meetingId]);

  // speech engine: chosen once the server tells us what is available
  const engine: "server" | "browser" | "none" = !ai || !o.aiConsent ? "none"
    : ai.stt.server_available && o.speechEngine !== "browser" ? "server"
    : browserRecognitionSupported() && o.speechEngine !== "server" ? "browser" : "none";
  useEffect(() => {
    if (!ai || !o.aiConsent) return;
    const chosen = engine;
    if (chosen === "none") pushError("No speech recognition available: configure server STT or use Chrome/Edge. You can still type statements.");

    vad.current?.close();
    seg.current?.close();
    rec.current?.stop();
    if (chosen === "server") seg.current = new ServerSegmenter(o.localStream, () => stateRef.current.spoken, sendUtterance);
    if (chosen === "browser") {
      rec.current = new BrowserRecognizer(() => bcp(stateRef.current.spoken), () => stateRef.current.spoken, sendUtterance, pushError);
      if (stateRef.current.mic) rec.current.start();
    }
    vad.current = new VoiceActivity(o.localStream, (active) => {
      const really = active && stateRef.current.mic && performance.now() >= playingUntil.current;
      setSelfSpeaking(really);
      sock.current?.send({ type: "speaking", active: really });
      seg.current?.voice(really);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, o.aiConsent, engine]);

  // lip-sync delay follows measured interpretation latency
  useEffect(() => {
    const needs = Object.values(remotes).some((r) => r.spoken !== listen);
    mesh.current?.setPlayoutDelay(lipSync && needs && latencyEwma ? latencyEwma : 0);
  }, [lipSync, latencyEwma, remotes, listen]);

  // adaptive video quality from the worst peer link
  const worst = Object.values(remotes).reduce<Quality>((w, r) => (r.quality === "poor" ? "poor" : r.quality === "fair" && w !== "poor" ? "fair" : w), "good");
  useEffect(() => {
    mesh.current?.setMaxVideoBitrate(worst === "poor" ? 600_000 : worst === "fair" ? 1_200_000 : 2_500_000);
  }, [worst]);

  useEffect(() => {
    if (player.current) player.current.volume = o.translatedVolume;
  }, [o.translatedVolume]);

  // ------------------------------------------------------------------ controls
  const toggleMic = useCallback(() => {
    setMic((v) => {
      const next = !v;
      stateRef.current.mic = next;
      mesh.current?.setTrackEnabled("audio", next);
      if (next) rec.current?.start();
      else {
        rec.current?.stop();
        seg.current?.voice(false);
        setSelfSpeaking(false);
      }
      sock.current?.send({ type: "state", mic: next });
      return next;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCam((v) => {
      const next = !v;
      mesh.current?.setTrackEnabled("video", next);
      sock.current?.send({ type: "state", cam: next });
      return next;
    });
  }, []);

  const toggleHand = useCallback(() => {
    setHand((v) => {
      sock.current?.send({ type: "state", hand: !v });
      return !v;
    });
  }, []);

  const setLanguages = useCallback((sp: string, li: string) => {
    stateRef.current.spoken = sp;
    stateRef.current.listen = li;
    setSpokenState(sp);
    setListenState(li);
    sock.current?.send({ type: "lang", spoken: sp, listen: li, auto_detect: o.autoDetect });
    rec.current?.restart();
  }, [o.autoDetect]);

  const sendTyped = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    sock.current?.send({ type: "speech.text", utterance_id: newUtteranceId(), text: t, language: stateRef.current.spoken, confidence: 1, client_ts: Date.now() });
  }, []);

  return {
    conn, connInfo, info, ai, remotes, feed, partial, mic, cam, hand, selfSpeaking, spoken, listen, recording, errors, engine,
    lipSync, setLipSync, latencyEwma, aiPlaying,
    toggleMic, toggleCam, toggleHand, setLanguages, sendTyped,
    requestRecording: () => sock.current?.send({ type: "recording.request" }),
    consentRecording: (accept: boolean) => {
      sock.current?.send({ type: "recording.consent", accept });
      setRecording((r) => ({ ...r, consentRequested: false }));
    },
    stopRecording: () => sock.current?.send({ type: "recording.stop" }),
    simulateDrop: () => sock.current?.dropForTest(),
    dismissError: (i: number) => setErrors((e) => e.filter((_, j) => j !== i)),
    leave: () => {
      sock.current?.close();
      mesh.current?.close();
      player.current?.stop();
    },
  };
}
