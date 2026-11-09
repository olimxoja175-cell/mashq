import { Brand } from "./Shell";
import { cx } from "./ui";

export function AuthFrame({ step, children }: { step: 1 | 2; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-e border-navy-700 bg-navy-900/60 p-12 lg:flex">
        <Brand />
        <div>
          <p className="font-serif text-4xl leading-tight text-ivory">
            Every leader speaks their own language.
            <br />
            <span className="text-gold-400">Every leader is understood.</span>
          </p>
          <div className="gold-rule my-8 w-48" />
          <ul className="space-y-3 text-sm text-navy-300">
            <li>◈ Live video, peer-to-peer and end-to-end encrypted</li>
            <li>◈ Simultaneous AI interpretation in 14 languages</li>
            <li>◈ Consent-based voice identity — nobody speaks in your voice but you</li>
            <li>◈ Multi-factor identity verification and tamper-evident audit</li>
          </ul>
        </div>
        <p className="text-xs text-navy-400">Restricted system. Unauthorized access is prohibited and recorded.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Brand /></div>
          <ol className="mb-6 flex items-center gap-3 text-xs">
            {["Credentials", "Identity verification"].map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span className={cx("flex h-6 w-6 items-center justify-center rounded-full border", i + 1 <= step ? "border-gold-500 bg-gold-500 text-navy-950" : "border-navy-600 text-navy-400")}>{i + 1}</span>
                <span className={i + 1 === step ? "text-ivory" : "text-navy-400"}>{label}</span>
                {i === 0 && <span className="mx-1 h-px w-8 bg-navy-600" />}
              </li>
            ))}
          </ol>
          <div className="panel p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
