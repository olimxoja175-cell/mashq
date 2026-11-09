"use client";

import { useState } from "react";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import type { UserSettings } from "./types";

/** Edit-and-save helper for /api/settings shared by settings pages. */
export function useSettingsForm() {
  const { me, refresh } = useAuth();
  const [draft, setDraft] = useState<Partial<UserSettings>>({});
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const value = { ...(me?.settings as UserSettings), ...draft } as UserSettings;

  function set<K extends keyof UserSettings>(k: K, v: UserSettings[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setStatus(null);
  }

  async function save() {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PUT", body: draft });
      await refresh();
      setDraft({});
      setStatus({ tone: "success", text: "Saved" });
    } catch (e) {
      setStatus({ tone: "danger", text: e instanceof ApiError ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return { value, set, save, busy, status, dirty: Object.keys(draft).length > 0 };
}
