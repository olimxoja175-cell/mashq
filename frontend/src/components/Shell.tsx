"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import type { TKey } from "@/lib/i18n";
import { Avatar, Badge, Flag, Spinner, cx } from "./ui";

type NavItem = { href: string; key: TKey; icon: string; perm?: string };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Office",
    items: [
      { href: "/dashboard", key: "dashboard", icon: "◈" },
      { href: "/meetings/new", key: "newMeeting", icon: "＋", perm: "meeting.create" },
      { href: "/invitations", key: "invitations", icon: "✉" },
      { href: "/meetings/scheduled", key: "scheduled", icon: "◷" },
      { href: "/meetings/history", key: "history", icon: "☰" },
      { href: "/contacts", key: "contacts", icon: "⚑" },
      { href: "/profile", key: "profile", icon: "◉" },
    ],
  },
  {
    section: "Settings",
    items: [
      { href: "/settings/language", key: "languageSettings", icon: "文" },
      { href: "/settings/audio", key: "audioSettings", icon: "♪" },
      { href: "/settings/security", key: "securitySettings", icon: "⛨" },
    ],
  },
  {
    section: "Administration",
    items: [
      { href: "/admin", key: "administration", icon: "⚙", perm: "admin.users" },
      { href: "/admin/monitoring", key: "monitoring", icon: "∿", perm: "system.monitor" },
      { href: "/admin/access", key: "access", icon: "⚿", perm: "admin.access" },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, t, can, logout, ai } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  if (loading || !me) return <Spinner />;

  const nav = (
    <nav className="flex flex-col gap-6">
      {NAV.map((sec) => {
        const items = sec.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={sec.section}>
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy-400">{sec.section}</div>
            {items.map((i) => {
              const active = path === i.href || (i.href !== "/admin" && path.startsWith(i.href + "/"));
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className={cx(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                    active ? "bg-gold-500/10 text-gold-300" : "text-ivory/75 hover:bg-navy-700/50 hover:text-ivory",
                  )}
                >
                  <span className="w-4 text-center text-gold-500/80">{i.icon}</span>
                  {t(i.key)}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-navy-700 bg-navy-900/80 px-3 py-6 lg:flex">
        <Brand />
        <div className="mt-8 flex-1 overflow-y-auto">{nav}</div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 border-e border-navy-700 bg-navy-900 px-3 py-6" onClick={(e) => e.stopPropagation()}>
            <Brand />
            <div className="mt-8">{nav}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-navy-700 bg-navy-950/85 px-4 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 text-ivory lg:hidden" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
          <div className="hidden items-center gap-2 md:flex">
            <Badge tone="success">⛨ MFA session</Badge>
            {ai?.development_mode ? (
              <Badge tone="warning">{t("devMode")}: simulated translation</Badge>
            ) : ai ? (
              <Badge tone="gold">AI: {ai.translation.provider}</Badge>
            ) : null}
          </div>
          <div className="ms-auto flex items-center gap-3">
            <div className="hidden text-end sm:block">
              <div className="text-sm text-ivory">{me.name}</div>
              <div className="flex items-center justify-end gap-2 text-xs text-navy-300">
                <Flag code={me.country?.code} /> {me.title}
              </div>
            </div>
            <Avatar name={me.name} size={36} />
            <button onClick={logout} className="rounded-lg border border-navy-600 px-3 py-1.5 text-xs text-ivory/80 hover:border-gold-500">
              {t("signOut")}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 px-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold-500 font-serif text-gold-400">W</span>
      <span>
        <span className="block font-serif text-lg tracking-[0.25em] text-ivory">WORLDVOICE</span>
        <span className="block text-[9px] uppercase tracking-[0.3em] text-gold-500/80">Presidential Communication</span>
      </span>
    </Link>
  );
}
