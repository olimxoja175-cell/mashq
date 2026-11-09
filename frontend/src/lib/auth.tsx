"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setUnauthorizedHandler } from "./api";
import { applyDocumentLanguage, translator, TKey } from "./i18n";
import type { AIStatus, Language, Me } from "./types";

type Ctx = {
  me: Me | null;
  loading: boolean;
  languages: Language[];
  ai: AIStatus | null;
  refresh: () => Promise<Me | null>;
  setMe: (m: Me) => void;
  logout: () => Promise<void>;
  t: (k: TKey) => string;
  can: (perm: string) => boolean;
  langName: (code?: string | null) => string;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [ai, setAi] = useState<AIStatus | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me }>("/api/auth/me");
      setMe(r.user);
      api<AIStatus>("/api/ai/status").then(setAi).catch(() => {});
      return r.user;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    api<Language[]>("/api/languages").then(setLanguages).catch(() => {});
    setUnauthorizedHandler(() => {
      setMe(null);
      router.replace("/login?expired=1");
    });
  }, [refresh, router]);

  const uiLang = me?.settings?.ui_language || "en";
  useEffect(() => {
    applyDocumentLanguage(uiLang);
  }, [uiLang]);

  const value = useMemo<Ctx>(
    () => ({
      me,
      loading,
      languages,
      ai,
      refresh,
      setMe,
      logout: async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(() => {});
        setMe(null);
        router.replace("/login");
      },
      t: translator(uiLang),
      can: (p) => !!me?.permissions.includes(p),
      langName: (code) => languages.find((l) => l.code === code)?.name || code || "—",
    }),
    [me, loading, languages, ai, refresh, router, uiLang],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

/** Redirects to /login when there is no session. */
export function useRequireAuth(perm?: string) {
  const ctx = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ctx.loading) return;
    if (!ctx.me) router.replace("/login");
    else if (perm && !ctx.can(perm)) router.replace("/dashboard");
  }, [ctx, perm, router]);
  return ctx;
}
