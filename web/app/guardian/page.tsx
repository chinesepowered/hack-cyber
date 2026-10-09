import Link from "next/link";

// This file deliberately contains no backslash escapes and no invisible
// characters. Every backslash is built at runtime, because the agent that
// wrote it edits files through JSON tool calls, and JSON silently decodes a
// backslash-u escape into the raw character. That is the bug this page is
// about; see docs/semgrep-guardian-finding.md.
const BS = String.fromCharCode(92);
const esc = (cp: number) => `${BS}u${cp.toString(16).padStart(4, "0")}`;

function Hidden({ cp }: { cp: number }) {
  return (
    <span className="mx-0.5 inline-block rounded-md bg-[#ff6b6b] px-1.5 py-0.5 align-middle text-[13px] font-bold text-white">
      U+{cp.toString(16).toUpperCase()}
    </span>
  );
}

const TIMES = [
  { where: "scanner/beagle/scan.py", what: "The Trojan Source detector's own regex" },
  { where: "README.md", what: "The sentence showing the fix" },
  { where: "docs/semgrep-guardian-finding.md", what: "The write-up of this finding" },
];

export default function GuardianPage() {
  const fixed = `r"[${esc(0x202a)}-${esc(0x202e)}${esc(0x2066)}-${esc(0x2069)}]"`;

  return (
    <main className="mx-auto flex h-screen max-w-[1400px] flex-col gap-5 px-8 py-7">
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/scout-alert.png" alt="Scout barking" width={64} height={64} className="animate-bark" />
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand">
            Semgrep Guardian · scanning the AI that wrote this repo
          </div>
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink">
            The agent wrote Trojan Source into our Trojan Source detector
          </h1>
        </div>
        <Link href="/" className="ml-auto text-[14px] font-medium text-ink-2 underline-offset-4 hover:underline">
          Back to dashboard
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-5">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3 text-[14px] font-semibold text-ink-2">
            What every editor and every diff showed
          </div>
          <pre className="bg-code px-5 py-6 font-mono text-[20px] text-code-text">
            INVISIBLE = re.compile(r&quot;[-]&quot;)
          </pre>
        </div>
        <div className="card overflow-hidden ring-2 ring-bad/40">
          <div className="border-b border-bad-line bg-bad-soft px-5 py-3 text-[14px] font-semibold text-bad">
            What was actually in the file
          </div>
          <pre className="bg-code px-5 py-6 font-mono text-[20px] leading-[1.9] text-code-text">
            INVISIBLE = re.compile(r&quot;[<Hidden cp={0x202a} />-<Hidden cp={0x202e} />
            <Hidden cp={0x2066} />-<Hidden cp={0x2069} />]&quot;)
          </pre>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-[14px]">
        <span className="rounded-full bg-ink px-3 py-1 font-mono font-semibold text-white">
          semgrep · contains-bidirectional-characters
        </span>
        <span className="font-mono text-ink-2">scanner/beagle/scan.py:36</span>
        <span className="text-ink-2">CVE-2021-42574 class: code that reads differently to a human than to the parser</span>
      </div>

      <section className="grid min-h-0 flex-1 grid-cols-[1.15fr_1fr] gap-5">
        <div className="card px-6 py-5">
          <div className="text-[18px] font-semibold text-ink">It happened three times</div>
          <ol className="mt-4 space-y-3">
            {TIMES.map((t, i) => (
              <li key={t.where} className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bad text-[14px] font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[16px] font-medium text-ink">{t.what}</div>
                  <div className="font-mono text-[13px] text-ink-3">{t.where}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 rounded-xl bg-brand-soft px-4 py-3 text-[15px] leading-relaxed text-ink">
            <strong>Why:</strong> the agent edits files through JSON tool calls, and JSON decodes a
            backslash-u escape into the character itself. Every time it typed the <em>safe</em>{" "}
            form, the file got the invisible one. Only a tool that reads bytes, not glyphs, sees it.
          </p>
        </div>

        <div className="card flex flex-col px-6 py-5">
          <div className="text-[18px] font-semibold text-good">Fixed</div>
          <pre className="mt-3 rounded-xl bg-code px-4 py-4 font-mono text-[16px] text-[#8ee6d6]">
            INVISIBLE = re.compile({fixed})
          </pre>
          <ul className="mt-4 space-y-2 text-[15px] text-ink">
            <li>Still catches real Trojan Source; still ignores BOM handling</li>
            <li>
              <span className="font-mono text-[14px]">scripts/check_invisible.py</span> sweeps every
              file
            </li>
          </ul>
          <div className="mt-auto grid grid-cols-2 gap-3 pt-4">
            <div className="rounded-xl bg-good-soft px-4 py-3 ring-1 ring-good-line">
              <div className="text-[28px] font-bold tabular-nums text-good">12 → 0</div>
              <div className="text-[13px] text-ink-2">Semgrep findings in AI-written code</div>
            </div>
            <div className="rounded-xl bg-good-soft px-4 py-3 ring-1 ring-good-line">
              <div className="text-[28px] font-bold tabular-nums text-good">13/13</div>
              <div className="text-[13px] text-ink-2">detection rule tests passing</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
