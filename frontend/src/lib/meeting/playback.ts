"use client";

/**
 * Interpreted-speech player.
 *  - Strict single queue: translated speech never overlaps.
 *  - De-duplication by (utterance id, language): the same translation is never played twice.
 *  - Adaptive catch-up: when the queue backs up, playback rate rises slightly (max 1.2×)
 *    so the listener does not drift further behind the live speaker.
 *  - Server audio (MP3, possibly in the speaker's consented voice) or, when the
 *    deployment has no speech-synthesis provider, the browser's local speech synthesis.
 */

export type PlayItem = {
  key: string;
  speakerId: string;
  language: string;
  bcp47: string;
  text: string;
  audioB64?: string | null;
  mime?: string;
};

export class TranslationPlayer {
  private queue: PlayItem[] = [];
  private seen = new Set<string>();
  private playing = false;
  private audio: HTMLAudioElement | null = null;
  volume = 1;
  enabled = true;

  constructor(private onStart: (item: PlayItem) => void, private onEnd: (item: PlayItem) => void) {}

  enqueue(item: PlayItem) {
    if (!this.enabled || this.seen.has(item.key)) return;
    this.seen.add(item.key);
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    this.queue.push(item);
    if (!this.playing) this.next();
  }

  get backlog() {
    return this.queue.length;
  }

  private rate(): number {
    return this.queue.length >= 3 ? 1.2 : this.queue.length === 2 ? 1.1 : 1;
  }

  private async next() {
    const item = this.queue.shift();
    if (!item) {
      this.playing = false;
      return;
    }
    this.playing = true;
    this.onStart(item);
    try {
      if (item.audioB64) await this.playAudio(item);
      else await this.speakLocally(item);
    } catch (e) {
      console.warn("playback failed", e);
    }
    this.onEnd(item);
    this.next();
  }

  private playAudio(item: PlayItem): Promise<void> {
    return new Promise((resolve) => {
      const a = new Audio(`data:${item.mime || "audio/mpeg"};base64,${item.audioB64}`);
      a.volume = this.volume;
      a.playbackRate = this.rate();
      this.audio = a;
      a.onended = a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }

  private speakLocally(item: PlayItem): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === "undefined") return resolve();
      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = item.bcp47;
      const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(item.language));
      if (voice) u.voice = voice;
      u.volume = this.volume;
      u.rate = this.rate();
      // safety: never block the queue on a stuck synthesizer
      const guard = window.setTimeout(() => {
        speechSynthesis.cancel();
        resolve();
      }, 4000 + item.text.length * 120);
      u.onend = u.onerror = () => {
        clearTimeout(guard);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.queue = [];
    this.audio?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.playing = false;
  }
}
