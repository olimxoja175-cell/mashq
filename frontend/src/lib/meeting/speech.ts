"use client";

/**
 * Speech capture.
 *  - VoiceActivity: energy-based voice activity detection on the local microphone
 *    (drives the speaking indicator and segments audio for server recognition).
 *  - ServerSegmenter: records each spoken segment (Opus/WebM) and hands it over for
 *    server-side recognition (OpenAI Whisper with language identification).
 *  - BrowserRecognizer: the browser's Web Speech API (Chrome/Edge). Works without
 *    server STT keys; note that Chrome sends the audio to its vendor's speech service.
 */

export type Utterance = { id: string; text?: string; audio?: Blob; language: string; confidence?: number; final: boolean };

export function newUtteranceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class VoiceActivity {
  private ctx: AudioContext;
  private an: AnalyserNode;
  private raf = 0;
  private speaking = false;
  private lastVoice = 0;
  level = 0;

  constructor(stream: MediaStream, private onChange: (speaking: boolean) => void, private threshold = 0.035, private hangMs = 750) {
    this.ctx = new AudioContext();
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 1024;
    this.ctx.createMediaStreamSource(stream).connect(this.an);
    const buf = new Float32Array(this.an.fftSize);
    const loop = () => {
      this.an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      this.level = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (this.level > this.threshold) this.lastVoice = now;
      const active = now - this.lastVoice < this.hangMs;
      if (active !== this.speaking) {
        this.speaking = active;
        this.onChange(active);
      }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.ctx.close().catch(() => {});
  }
}

export class ServerSegmenter {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private started = 0;
  private maxTimer: number | undefined;
  enabled = true;

  constructor(private stream: MediaStream, private language: () => string, private onUtterance: (u: Utterance) => void, private maxMs = 12000) {}

  /** Called by VoiceActivity. */
  voice(active: boolean) {
    if (!this.enabled) return;
    if (active && !this.rec) this.start();
    else if (!active && this.rec) this.stop();
  }

  private start() {
    const audioOnly = new MediaStream(this.stream.getAudioTracks());
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(audioOnly, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      const dur = performance.now() - this.started;
      const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
      if (dur > 400 && blob.size > 2000) this.onUtterance({ id: newUtteranceId(), audio: blob, language: this.language(), final: true });
    };
    rec.start();
    this.started = performance.now();
    this.rec = rec;
    // long statements are cut into segments so interpretation keeps pace
    this.maxTimer = window.setTimeout(() => {
      this.stop();
      this.start();
    }, this.maxMs);
  }

  private stop() {
    clearTimeout(this.maxTimer);
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.rec = null;
  }

  close() {
    this.enabled = false;
    this.stop();
  }
}

type SR = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};

export function browserRecognitionSupported(): boolean {
  return typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition);
}

export class BrowserRecognizer {
  private sr: SR | null = null;
  private active = false;
  private current = newUtteranceId();

  constructor(private bcp47: () => string, private language: () => string, private onUtterance: (u: Utterance) => void, private onError: (msg: string) => void) {}

  start() {
    if (this.active) return;
    const Ctor = ((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as new () => SR;
    if (!Ctor) return this.onError("This browser has no built-in speech recognition. Use Chrome/Edge or configure server speech recognition.");
    this.active = true;
    const sr = new Ctor();
    sr.lang = this.bcp47();
    sr.continuous = true;
    sr.interimResults = true;
    sr.maxAlternatives = 1;
    sr.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        const text = alt.transcript.trim();
        if (!text) continue;
        this.onUtterance({ id: this.current, text, language: this.language(), confidence: res.isFinal ? alt.confidence || undefined : undefined, final: res.isFinal });
        if (res.isFinal) this.current = newUtteranceId();
      }
    };
    sr.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.onError("Speech recognition permission denied.");
      } else if (e.error === "language-not-supported") {
        this.active = false;
        this.onError(`Browser speech recognition does not support ${this.bcp47()}. Configure server speech recognition or type statements.`);
      }
    };
    sr.onend = () => {
      // Chrome stops after silence; keep listening while the microphone is on
      if (this.active) setTimeout(() => this.safeStart(), 150);
    };
    this.sr = sr;
    this.safeStart();
  }

  private safeStart() {
    if (!this.active || !this.sr) return;
    try {
      this.sr.start();
    } catch {
      /* already started */
    }
  }

  restart() {
    this.stop();
    this.start();
  }

  stop() {
    this.active = false;
    try {
      this.sr?.abort();
    } catch {
      /* ignore */
    }
    this.sr = null;
  }
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
