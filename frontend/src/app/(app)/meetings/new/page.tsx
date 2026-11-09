"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Contact, Meeting } from "@/lib/types";
import { Alert, Button, Card, Empty, Field, OfficialLine, PageHeader, cx, inputCls } from "@/components/ui";

export default function NewMeeting() {
  const { t, langName } = useAuth();
  const router = useRouter();
  const contacts = useApi<Contact[]>("/api/contacts");
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [mode, setMode] = useState<"now" | "later">("now");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(60);
  const [level, setLevel] = useState("confidential");
  const [recording, setRecording] = useState("disabled");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const authorized = contacts.data?.filter((c) => c.authorized) || [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const startDt = mode === "later" && start ? new Date(start) : null;
      const m = await api<Meeting>("/api/meetings", {
        body: {
          title, agenda, message, security_level: level, recording_policy: recording, invitee_ids: selected,
          scheduled_start: startDt ? startDt.toISOString() : new Date().toISOString(),
          scheduled_end: startDt ? new Date(startDt.getTime() + duration * 60000).toISOString() : null,
        },
      });
      router.push(mode === "now" ? `/meeting/${m.id}` : "/meetings/scheduled");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create meeting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("newMeeting")} subtitle="Invitations are delivered only to your authorized, identity-verified contacts." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <Card title="Meeting" className="lg:col-span-2">
          <div className="grid gap-4">
            <Field label="Title"><input className={inputCls} required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bilateral consultations on trade and energy" /></Field>
            <Field label="Agenda" hint="Shared with invited participants. Terms here also help the interpreter with names and terminology.">
              <textarea className={inputCls} rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["now", "later"] as const).map((m) => (
                <button type="button" key={m} onClick={() => setMode(m)} className={cx("rounded-lg border p-4 text-start", mode === m ? "border-gold-500 bg-gold-500/5" : "border-navy-600")}>
                  <div className="font-medium text-ivory">{m === "now" ? "Start immediately" : "Schedule for later"}</div>
                  <div className="text-xs text-navy-300">{m === "now" ? "Open the room now; invitees join when they accept." : "Choose a date and time."}</div>
                </button>
              ))}
            </div>
            {mode === "later" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start"><input type="datetime-local" className={inputCls} required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Duration (minutes)"><input type="number" min={15} max={480} step={15} className={inputCls} value={duration} onChange={(e) => setDuration(+e.target.value)} /></Field>
              </div>
            )}
            <Field label="Personal message to invitees"><input className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="Security policy">
          <div className="grid gap-4">
            <Field label="Classification">
              <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="standard">Standard</option>
                <option value="confidential">Confidential</option>
                <option value="top_secret">Top secret</option>
              </select>
            </Field>
            <Field label="Official record" hint="Off by default. If permitted, a record starts only after every participant consents in the room, and everyone sees an indicator.">
              <select className={inputCls} value={recording} onChange={(e) => setRecording(e.target.value)}>
                <option value="disabled">Not permitted</option>
                <option value="all_consent">Permitted with consent of all participants</option>
              </select>
            </Field>
            <Alert tone="info">Video and voice travel directly between participants, encrypted end-to-end. Speech is sent to the interpretation service only after each participant consents in the lobby.</Alert>
          </div>
        </Card>

        <Card title={`Participants (${selected.length} selected)`} className="lg:col-span-3">
          {contacts.loading ? null : authorized.length === 0 ? (
            <Empty>No authorized contacts yet. <Link href="/contacts" className="text-gold-400 underline">Add contacts</Link> first.</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {authorized.map((c) => {
                const on = selected.includes(c.user.id);
                return (
                  <button type="button" key={c.id} onClick={() => setSelected(on ? selected.filter((x) => x !== c.user.id) : [...selected, c.user.id])}
                    className={cx("min-w-0 rounded-lg border p-3 text-start transition", on ? "border-gold-500 bg-gold-500/5" : "border-navy-700 hover:border-navy-500")}>
                    <OfficialLine u={c.user} extra={<span className={cx("flex h-5 w-5 items-center justify-center rounded border text-xs", on ? "border-gold-500 bg-gold-500 text-navy-950" : "border-navy-500")}>{on ? "✓" : ""}</span>} />
                    <div className="mt-2 text-xs text-navy-400">Speaks {langName(c.user.language)}</div>
                  </button>
                );
              })}
            </div>
          )}
          {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
          <div className="mt-6 flex gap-3">
            <Button type="submit" size="lg" loading={busy}>{mode === "now" ? "Create and enter room" : "Schedule and send invitations"}</Button>
            <Button type="button" size="lg" variant="ghost" onClick={() => router.back()}>{t("cancel")}</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
