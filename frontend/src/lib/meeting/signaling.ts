"use client";

import { api, wsBase } from "../api";

export type ConnState = "connecting" | "connected" | "reconnecting" | "closed" | "ended" | "denied";
type Handler = (msg: Record<string, unknown> & { type: string }) => void;

export type TicketBody = { ai_consent: boolean; spoken_language: string; listen_language: string };

/**
 * Meeting WebSocket with automatic recovery.
 * - Each (re)connection obtains a fresh single-use ticket (tickets are never reused).
 * - Messages carry a strictly increasing `seq` (server drops replays).
 * - Exponential back-off 1 s → 10 s; heartbeat measures RTT every 5 s.
 */
export class MeetingSocket {
  private ws: WebSocket | null = null;
  private seq = 0;
  private attempts = 0;
  private closedByUser = false;
  private heartbeat: number | undefined;
  private retryTimer: number | undefined;
  public rtt: number | null = null;
  public iceServers: RTCIceServer[] = [];

  constructor(
    private meetingId: string,
    private ticketBody: () => TicketBody,
    private onMessage: Handler,
    private onState: (s: ConnState, info?: string) => void,
  ) {}

  async connect(): Promise<void> {
    this.onState(this.attempts === 0 ? "connecting" : "reconnecting");
    let ticket: string;
    try {
      const r = await api<{ ticket: string; ice_servers: RTCIceServer[] }>(`/api/meetings/${this.meetingId}/ticket`, { body: this.ticketBody() });
      ticket = r.ticket;
      this.iceServers = r.ice_servers;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403 || status === 404) return this.onState("denied", (e as Error).message);
      if (status === 409) return this.onState("ended", (e as Error).message);
      return this.scheduleRetry();
    }
    if (this.closedByUser) return; // closed while the ticket request was in flight
    const ws = new WebSocket(`${wsBase()}/ws/meetings/${this.meetingId}?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;
    this.seq = 0;
    ws.onopen = () => {
      this.attempts = 0;
      this.onState("connected");
      clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => this.send({ type: "ping", t: performance.now(), rtt: this.rtt }), 5000);
    };
    ws.onmessage = (ev) => {
      if (this.closedByUser || this.ws !== ws) return;
      let msg: Record<string, unknown> & { type: string };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "pong" && typeof msg.t === "number") {
        this.rtt = Math.round(performance.now() - msg.t);
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = (ev) => {
      clearInterval(this.heartbeat);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return this.onState("closed");
      if (ev.code === 4000) return this.onState("ended");
      if (ev.code === 4001) return this.onState("closed", "This meeting was opened on another device or tab.");
      if (ev.code === 4403) return this.onState("denied", "Access to this meeting was refused.");
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.closedByUser) return;
    this.attempts += 1;
    this.onState("reconnecting");
    const delay = Math.min(10000, 1000 * 2 ** Math.min(this.attempts - 1, 4));
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.seq += 1;
    this.ws.send(JSON.stringify({ ...msg, seq: this.seq }));
    return true;
  }

  /** Simulate a network drop (used by the in-meeting diagnostics). */
  dropForTest() {
    this.ws?.close(4999);
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.ws?.close(1000);
  }
}
