"use client";

import { ButtonHTMLAttributes, ReactNode, forwardRef } from "react";
import { flag, supportsFlagEmoji } from "@/lib/i18n";
import type { UserCard } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "gold" | "ghost" | "outline" | "danger" | "subtle";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "gold", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  const v = {
    gold: "bg-gold-500 text-navy-950 hover:bg-gold-400 font-semibold",
    ghost: "text-ivory/80 hover:text-ivory hover:bg-navy-700/60",
    outline: "border border-navy-600 text-ivory hover:border-gold-500 hover:text-gold-300",
    danger: "bg-danger text-white hover:brightness-110 font-semibold",
    subtle: "bg-navy-700/70 text-ivory hover:bg-navy-600",
  }[variant];
  const s = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" }[size];
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed", v, s, className)}
      {...rest}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
});

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("panel min-w-0 p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {title && <h2 className="min-w-0 font-serif text-lg tracking-wide text-ivory">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-3xl tracking-wide text-ivory">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-300">{subtitle}</p>}
        <div className="gold-rule mt-4 w-40" />
      </div>
      {action}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "gold" | "success" | "warning" | "danger"; children: ReactNode; className?: string }) {
  const t = {
    neutral: "border-navy-600 text-navy-300",
    gold: "border-gold-600/60 text-gold-300 bg-gold-500/10",
    success: "border-success/50 text-success bg-success/10",
    warning: "border-warning/50 text-warning bg-warning/10",
    danger: "border-danger/50 text-danger bg-danger/10",
  }[tone];
  return <span className={cx("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", t, className)}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-navy-600 bg-navy-900/80 px-3 py-2.5 text-sm text-ivory placeholder:text-navy-400 focus:border-gold-500 focus:outline-none";

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <div className="text-sm text-ivory">{label}</div>
        {hint && <div className="text-xs text-navy-400">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-gold-500" : "bg-navy-600")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", checked ? "start-[22px]" : "start-0.5")} />
      </button>
    </div>
  );
}

export function Alert({ tone = "warning", children }: { tone?: "warning" | "danger" | "success" | "info"; children: ReactNode }) {
  const t = {
    warning: "border-warning/40 bg-warning/10 text-warning",
    danger: "border-danger/40 bg-danger/10 text-red-300",
    success: "border-success/40 bg-success/10 text-success",
    info: "border-gold-600/40 bg-gold-500/5 text-gold-300",
  }[tone];
  return <div className={cx("rounded-lg border px-4 py-3 text-sm", t)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-navy-600 px-4 py-8 text-center text-sm text-navy-400">{children}</div>;
}

export function Spinner() {
  return <div className="flex justify-center py-10"><span className="h-6 w-6 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" /></div>;
}

export function Flag({ code, className }: { code?: string | null; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)} title={code || ""}>
      {supportsFlagEmoji() && <span aria-hidden className="text-lg leading-none">{flag(code)}</span>}
      <span className="rounded border border-gold-600/50 px-1 text-[10px] font-bold tracking-wider text-gold-300">{code}</span>
    </span>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-gold-600/60 bg-navy-800 font-serif text-gold-300"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function OfficialLine({ u, extra }: { u: UserCard; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="shrink-0"><Avatar name={u.name} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-ivory">
          <span className="truncate">{u.name}</span> {u.verified && <span title="Identity verified" className="shrink-0 text-gold-400">✓</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-navy-300">
          <span className="shrink-0"><Flag code={u.country?.code} /></span> <span className="truncate">{u.title}, {u.country?.name}</span>
        </div>
      </div>
      {extra && <div className="ms-auto shrink-0">{extra}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = ({ live: "success", scheduled: "gold", ended: "neutral", cancelled: "danger", pending: "gold", accepted: "success", declined: "danger", revoked: "danger", expired: "neutral" } as const)[status as "live"] || "neutral";
  return <Badge tone={tone}>{status === "live" && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-success" />}{status}</Badge>;
}

export function SecurityLevel({ level }: { level: string }) {
  const map: Record<string, ["neutral" | "gold" | "danger", string]> = {
    standard: ["neutral", "Standard"],
    confidential: ["gold", "Confidential"],
    top_secret: ["danger", "Top secret"],
  };
  const [tone, label] = map[level] || ["neutral", level];
  return <Badge tone={tone}>🔒 {label}</Badge>;
}
