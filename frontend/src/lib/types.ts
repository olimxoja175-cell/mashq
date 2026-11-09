export type Country = { code: string; name: string };

export type UserCard = {
  id: string;
  name: string;
  title: string;
  organization: string;
  country: Country | null;
  verified: boolean;
  role: string;
  language: string | null;
};

export type UserSettings = {
  spoken_language: string;
  listen_language: string;
  ui_language: string;
  auto_detect_language: boolean;
  subtitles_enabled: boolean;
  show_original_subtitles: boolean;
  original_audio_volume: number;
  translated_audio_volume: number;
  use_voice_profile: boolean;
  noise_suppression: boolean;
  echo_cancellation: boolean;
  auto_gain: boolean;
  video_quality: "sd" | "hd" | "fhd";
  speech_engine: "auto" | "server" | "browser";
  session_idle_minutes: number;
};

export type Me = UserCard & {
  email: string;
  bio: string;
  verified_at: string | null;
  last_login_at: string | null;
  permissions: string[];
  settings: UserSettings;
};

export type Language = { code: string; name: string; native: string; bcp47: string; rtl: boolean };

export type Participant = UserCard & { meeting_role: string; joined_at: string | null; left_at: string | null };

export type Meeting = {
  id: string;
  title: string;
  agenda: string;
  status: "scheduled" | "live" | "ended" | "cancelled";
  security_level: "standard" | "confidential" | "top_secret";
  recording_policy: "disabled" | "all_consent";
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  host: UserCard;
  participants: Participant[];
  live_participants: number;
  my_role?: string;
  recording_active?: boolean;
};

export type Invitation = {
  id: string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  message: string;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
  meeting: { id: string; title: string; status: string; scheduled_start: string | null; security_level: string };
  inviter: UserCard;
  invitee: UserCard;
};

export type Contact = { id: string; note: string; authorized: boolean; created_at: string; user: UserCard };

export type AIStatus = {
  stt: { provider: string; server_available: boolean };
  translation: { provider: string; simulated: boolean };
  tts: { provider: string; voice_cloning: boolean };
  development_mode: boolean;
};
