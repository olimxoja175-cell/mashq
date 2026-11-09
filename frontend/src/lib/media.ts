// Shared camera constraints so the device check, the lobby and the meeting ask
// the camera for the same mode. Asking only for a width lets the browser pick a
// low-fps / low-resolution mode on many laptop webcams; give width, height and fps.
export type VideoQuality = "sd" | "hd" | "fhd";

const SIZES: Record<VideoQuality, [number, number]> = { sd: [640, 360], hd: [1280, 720], fhd: [1920, 1080] };

export function videoConstraints(quality: VideoQuality, deviceId?: string): MediaTrackConstraints {
  const [width, height] = SIZES[quality] ?? SIZES.hd;
  // Phones rotate frames with the device: forcing 16:9 there makes the browser crop/scale the
  // sensor image. Let the phone keep its native orientation; ask only for the size class.
  const phone = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
    ...(phone ? { facingMode: deviceId ? undefined : "user" } : { aspectRatio: { ideal: 16 / 9 } }),
  };
}

/** Human-readable actual camera mode, e.g. "1280×720 · 30 fps". */
export function describeVideo(stream: MediaStream | null): string {
  const t = stream?.getVideoTracks()[0];
  if (!t) return "";
  const s = t.getSettings();
  return [s.width && s.height ? `${s.width}×${s.height}` : "", s.frameRate ? `${Math.round(s.frameRate)} fps` : ""].filter(Boolean).join(" · ");
}
