"use client";

import { useAuth } from "@/lib/auth";
import { useSettingsForm } from "@/lib/useSettings";
import { Alert, Button, Card, Field, PageHeader, Toggle, cx, inputCls } from "@/components/ui";

const UI_TRANSLATED = new Set(["en", "uz", "ru", "ar", "fa", "zh"]);

export default function LanguageSettings() {
  const { t, languages, me } = useAuth();
  const f = useSettingsForm();
  if (!me) return null;
  const v = f.value;

  return (
    <div>
      <PageHeader title={t("languageSettings")} subtitle="Choose the language you speak and the language in which you hear every other participant." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("spokenLanguage")}>
          <p className="mb-4 text-sm text-navy-300">Your speech is recognised in this language. Automatic detection can switch if you change language mid-meeting.</p>
          <LangGrid value={v.spoken_language} onChange={(c) => f.set("spoken_language", c)} />
          <div className="mt-4 border-t border-navy-700 pt-3">
            <Toggle label="Automatic language detection" hint="Detect the spoken language from audio where the speech service supports it. Turn off to force the language above." checked={v.auto_detect_language} onChange={(x) => f.set("auto_detect_language", x)} />
          </div>
        </Card>
        <Card title={t("listenLanguage")}>
          <p className="mb-4 text-sm text-navy-300">Everyone else will be interpreted into this language for you. Speakers of this language are heard in their original voice.</p>
          <LangGrid value={v.listen_language} onChange={(c) => f.set("listen_language", c)} />
        </Card>
        <Card title="Interface language" className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Display language" hint="Arabic and Persian use a right-to-left layout.">
              <select className={inputCls} value={v.ui_language} onChange={(e) => f.set("ui_language", e.target.value)}>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>{l.native} — {l.name}{UI_TRANSLATED.has(l.code) ? "" : " (interface in English)"}</option>
                ))}
              </select>
            </Field>
            <div className="space-y-1">
              <Toggle label={t("subtitles")} checked={v.subtitles_enabled} onChange={(x) => f.set("subtitles_enabled", x)} />
              <Toggle label="Show original-language subtitles under the translation" checked={v.show_original_subtitles} onChange={(x) => f.set("show_original_subtitles", x)} />
            </div>
          </div>
        </Card>
      </div>
      <div className="mt-6 flex items-center gap-4">
        <Button onClick={f.save} loading={f.busy} disabled={!f.dirty}>{t("save")}</Button>
        {f.status && <Alert tone={f.status.tone}>{f.status.text}</Alert>}
      </div>
    </div>
  );
}

function LangGrid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { languages } = useAuth();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {languages.map((l) => (
        <button key={l.code} type="button" onClick={() => onChange(l.code)} dir={l.rtl ? "rtl" : "ltr"}
          className={cx("rounded-lg border px-3 py-2 text-start transition", value === l.code ? "border-gold-500 bg-gold-500/10" : "border-navy-700 hover:border-navy-500")}>
          <div className="text-sm text-ivory">{l.native}</div>
          <div className="text-[11px] text-navy-400">{l.name}</div>
        </button>
      ))}
    </div>
  );
}
