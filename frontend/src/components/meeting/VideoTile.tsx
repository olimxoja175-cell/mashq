"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Quality } from "@/lib/meeting/rtc";
import { flag, supportsFlagEmoji } from "@/lib/i18n";
import { cx } from "../ui";

type Props = {
  stream?: MediaStream | null;
  name: string;
  title: string;
  country: string;
  muted?: boolean; // local preview
  volume?: number;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
  aiSpeaking?: boolean;
  quality?: Quality;
  langLine: string;
  isSelf?: boolean;
  hand?: boolean;
  peerState?: string;
  big?: boolean;
  aiVoiceLabel: string;
  /** Remembers a manual rotation for this participant (phones sometimes send sideways frames). */
  rotateKey?: string;
};

export function VideoTile(p: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && p.stream && ref.current.srcObject !== p.stream) ref.current.srcObject = p.stream;
  }, [p.stream]);
  useEffect(() => {
    if (ref.current && p.volume !== undefined) ref.current.volume = Math.max(0, Math.min(1, p.volume));
  }, [p.volume]);

  // Manual rotation (0/90/180/270), saved per participant in this browser.
  const boxRef = useRef<HTMLDivElement>(null);
  const [rot, setRot] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!p.rotateKey) return;
    const v = Number(localStorage.getItem(`wv.rot.${p.rotateKey}`) || 0);
    setRot([0, 90, 180, 270].includes(v) ? v : 0);
  }, [p.rotateKey]);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  function rotate() {
    const next = (rot + 90) % 360;
    setRot(next);
    if (p.rotateKey) localStorage.setItem(`wv.rot.${p.rotateKey}`, String(next));
  }
  const sideways = rot === 90 || rot === 270;
  const videoStyle: CSSProperties | undefined = rot
    ? sideways && box.w && box.h
      ? { width: box.h, height: box.w, left: (box.w - box.h) / 2, top: (box.h - box.w) / 2, right: "auto", bottom: "auto", transform: `rotate(${rot}deg)` }
      : { transform: `rotate(${rot}deg)` }
    : undefined;

  const initials = p.name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("");
  const connecting = !p.isSelf && p.peerState !== "connected" && p.peerState !== undefined;

  return (
    <div ref={boxRef} className={cx("relative overflow-hidden rounded-2xl border bg-navy-900 transition-shadow", p.speaking || p.aiSpeaking ? "speaking-ring border-gold-400" : "border-navy-700", p.big ? "min-h-[160px] md:min-h-[280px]" : "min-h-[120px] md:min-h-[180px]")}>
      <video ref={ref} autoPlay playsInline muted={p.muted} style={videoStyle} className={cx("absolute inset-0 h-full w-full bg-black object-contain", p.isSelf && "-scale-x-100", !p.camOn && "invisible")} />
      {p.rotateKey && p.camOn && (
        <button
          type="button" onClick={rotate} title="Rotate video 90°" aria-label="Rotate video 90°"
          className="absolute start-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-navy-600 bg-black/60 text-base text-ivory hover:border-gold-400 hover:text-gold-300"
        >⟳</button>
      )}
      {!p.camOn && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-gold-600 bg-navy-800 font-serif text-3xl text-gold-300">{initials}</span>
        </div>
      )}
      {connecting && <div className="absolute inset-x-0 top-0 bg-black/50 py-1 text-center text-xs text-warning">Connecting media… ({p.peerState})</div>}

      <div className="absolute end-3 top-3 flex items-center gap-1.5">
        {p.hand && <span className="rounded-full bg-gold-500 px-2 py-0.5 text-xs text-navy-950">✋</span>}
        {p.aiSpeaking && <span className="rounded-full border border-gold-400 bg-navy-950/80 px-2 py-0.5 text-[11px] font-semibold text-gold-300">◉ {p.aiVoiceLabel}</span>}
        {p.quality && <Bars q={p.quality} />}
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-3 pt-10">
        <div className="flex items-end gap-3">
          {supportsFlagEmoji() ? (
            <span className="text-3xl leading-none" aria-hidden>{flag(p.country)}</span>
          ) : (
            <span className="rounded border border-gold-500 px-1.5 py-0.5 text-xs font-bold tracking-wider text-gold-300">{p.country}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 truncate text-base font-semibold text-white">
              {p.name}
              {!p.micOn && <span title="Microphone off" className="rounded bg-danger/80 px-1 text-[10px]">MIC OFF</span>}
            </div>
            <div className="truncate text-xs text-gold-300">{p.title} · {p.country}</div>
            <div className="truncate text-[11px] text-navy-300">{p.langLine}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bars({ q }: { q: Quality }) {
  const n = q === "good" ? 3 : q === "fair" ? 2 : q === "poor" ? 1 : 0;
  const color = q === "good" ? "bg-success" : q === "fair" ? "bg-warning" : "bg-danger";
  return (
    <span className="flex items-end gap-0.5 rounded bg-black/50 px-1.5 py-1" title={`Network: ${q}`}>
      {[1, 2, 3].map((i) => <span key={i} className={cx("w-1 rounded-sm", i <= n ? color : "bg-navy-600")} style={{ height: 4 + i * 3 }} />)}
    </span>
  );
}
