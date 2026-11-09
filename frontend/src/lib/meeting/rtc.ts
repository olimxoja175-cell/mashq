"use client";

/**
 * Peer-to-peer WebRTC mesh (one RTCPeerConnection per remote participant) using the
 * "perfect negotiation" pattern. Media is DTLS-SRTP encrypted end-to-end between the
 * browsers; the server only relays SDP/ICE. Suitable up to ~6 participants; larger
 * meetings need an SFU (see docs/ARCHITECTURE.md).
 */

export type Quality = "good" | "fair" | "poor" | "unknown";

type Peer = {
  pc: RTCPeerConnection;
  gen: string; // identifies this local connection instance
  remoteGen?: string; // the remote instance we are paired with
  initiator: boolean;
  tracksAdded: boolean;
  negotiated: boolean;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream;
  quality: Quality;
  lastBytes?: { t: number; bytes: number };
};

export type MeshEvents = {
  onSignal: (to: string, data: Record<string, unknown>) => void;
  onStream: (userId: string, stream: MediaStream) => void;
  onPeerState: (userId: string, state: RTCPeerConnectionState) => void;
  onQuality: (userId: string, q: Quality, rttMs: number | null) => void;
};

export class PeerMesh {
  peers = new Map<string, Peer>();
  private statsTimer: number | undefined;
  private delayMs = 0;

  constructor(private selfId: string, private local: MediaStream, private ice: () => RTCIceServer[], private ev: MeshEvents) {
    this.statsTimer = window.setInterval(() => this.pollStats(), 3000);
  }

  /** Newcomer side: create a connection and send the offer. */
  call(userId: string) {
    this.remove(userId);
    this.create(userId, true);
  }

  private create(userId: string, initiator: boolean, remoteGen?: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice(), bundlePolicy: "max-bundle" });
    const peer: Peer = {
      pc, gen: Math.random().toString(36).slice(2, 10), remoteGen, initiator, tracksAdded: false, negotiated: false,
      polite: this.selfId < userId, makingOffer: false, ignoreOffer: false, stream: new MediaStream(), quality: "unknown",
    };
    this.peers.set(userId, peer);
    const signal = (data: Record<string, unknown>) => this.ev.onSignal(userId, { ...data, gen: peer.gen, to_gen: peer.remoteGen });

    pc.onnegotiationneeded = async () => {
      // the answering side only renegotiates after the first exchange (e.g. ICE restart)
      if (!peer.initiator && !peer.negotiated) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        signal({ sdp: pc.localDescription?.toJSON() });
      } catch (e) {
        console.warn("negotiation failed", e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) signal({ candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track, receiver }) => {
      peer.stream.addTrack(track);
      this.applyDelay(receiver);
      this.ev.onStream(userId, new MediaStream(peer.stream.getTracks()));
    };
    pc.onconnectionstatechange = () => {
      this.ev.onPeerState(userId, pc.connectionState);
      if (pc.connectionState === "connected") peer.negotiated = true;
      if (pc.connectionState === "failed") pc.restartIce(); // network change / interruption recovery
    };
    if (initiator) this.addTracks(peer);
    return peer;
  }

  private addTracks(peer: Peer) {
    if (peer.tracksAdded) return;
    peer.tracksAdded = true;
    for (const track of this.local.getTracks()) {
      const sender = peer.pc.addTrack(track, this.local);
      if (track.kind === "video") void this.tuneVideoSender(sender);
    }
  }

  private videoBitrate = 2_500_000;

  /** Keep a sharp, smooth picture: cap at the current bitrate, 30 fps, and trade fps/resolution evenly. */
  private async tuneVideoSender(s: RTCRtpSender) {
    const params = s.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = this.videoBitrate;
    params.encodings[0].maxFramerate = 30;
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "balanced";
    await s.setParameters(params).catch(() => {});
  }

  async handleSignal(from: string, data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; gen?: string; to_gen?: string }) {
    let peer = this.peers.get(from);
    const isOffer = data.sdp?.type === "offer";
    if (isOffer && (!peer || (peer.remoteGen && peer.remoteGen !== data.gen))) {
      // first offer, or the remote side restarted its connection: start a fresh answering peer
      if (peer && peer.remoteGen && peer.remoteGen !== data.gen) this.remove(from);
      peer = this.peers.get(from) || this.create(from, false, data.gen);
    }
    if (!peer) return; // stray answer/candidate for a connection we no longer have
    if (data.to_gen && data.to_gen !== peer.gen) return; // addressed to an older local connection
    if (peer.remoteGen && data.gen && data.gen !== peer.remoteGen && !isOffer) return; // from an older remote connection
    if (!peer.remoteGen && data.gen) peer.remoteGen = data.gen;
    const { pc } = peer;
    try {
      if (data.sdp) {
        const offerCollision = isOffer && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        if (data.sdp.type === "answer" && pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(data.sdp);
        if (isOffer) {
          this.addTracks(peer); // after SRD so the offered transceivers are reused
          await pc.setLocalDescription();
          peer.negotiated = true;
          this.ev.onSignal(from, { sdp: pc.localDescription?.toJSON(), gen: peer.gen, to_gen: peer.remoteGen });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!peer.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn("signal handling failed", e);
    }
  }

  remove(userId: string) {
    const p = this.peers.get(userId);
    if (!p) return;
    p.pc.close();
    this.peers.delete(userId);
  }


  setTrackEnabled(kind: "audio" | "video", enabled: boolean) {
    this.local.getTracks().filter((t) => t.kind === kind).forEach((t) => (t.enabled = enabled));
  }

  /** Lower outgoing video bitrate when the network degrades (adaptive quality). */
  async setMaxVideoBitrate(bps: number) {
    this.videoBitrate = bps;
    for (const p of this.peers.values()) {
      for (const s of p.pc.getSenders()) {
        if (s.track?.kind !== "video") continue;
        const params = s.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = bps;
        await s.setParameters(params).catch(() => {});
      }
    }
  }

  /**
   * Lip-sync for interpreted speech: hold remote video (and the original audio with it)
   * in the jitter buffer by roughly the measured interpretation latency, so the
   * speaker's lips line up better with the translated voice. Uses
   * RTCRtpReceiver.jitterBufferTarget where the browser supports it (Chromium).
   */
  setPlayoutDelay(ms: number) {
    this.delayMs = Math.max(0, Math.min(4000, Math.round(ms)));
    for (const p of this.peers.values()) p.pc.getReceivers().forEach((r) => this.applyDelay(r));
  }

  static playoutDelaySupported(): boolean {
    return typeof RTCRtpReceiver !== "undefined" && "jitterBufferTarget" in RTCRtpReceiver.prototype;
  }

  private applyDelay(r: RTCRtpReceiver) {
    if ("jitterBufferTarget" in r) (r as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = this.delayMs || null;
  }

  private lossBase = new Map<string, { lost: number; received: number }>();

  private async pollStats() {
    for (const [uid, p] of this.peers) {
      if (p.pc.connectionState !== "connected") continue;
      try {
        const stats = await p.pc.getStats();
        let rtt: number | null = null;
        let lost = 0;
        let received = 0;
        const prev = this.lossBase.get(uid) || { lost: 0, received: 0 };
        stats.forEach((s) => {
          if (s.type === "candidate-pair" && s.state === "succeeded" && s.nominated && typeof s.currentRoundTripTime === "number") rtt = s.currentRoundTripTime * 1000;
          if (s.type === "inbound-rtp") {
            lost += s.packetsLost || 0;
            received += s.packetsReceived || 0;
          }
        });
        // loss over the last interval only, so one early burst does not pin the link at "poor"
        const dLost = Math.max(0, lost - prev.lost), dRecv = Math.max(0, received - prev.received);
        this.lossBase.set(uid, { lost, received });
        const lossPct = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;
        const q: Quality = rtt === null ? "unknown" : rtt > 400 || lossPct > 8 ? "poor" : rtt > 200 || lossPct > 3 ? "fair" : "good";
        if (q !== p.quality) p.quality = q;
        this.ev.onQuality(uid, q, rtt);
      } catch {
        /* peer closed */
      }
    }
  }

  close() {
    clearInterval(this.statsTimer);
    for (const uid of [...this.peers.keys()]) this.remove(uid);
  }
}
