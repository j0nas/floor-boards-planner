import type { Diagnostic } from "../../domain/index.ts";

const STYLE: Record<Diagnostic["severity"], string> = {
  error: "border-red-300 bg-red-50 text-red-800",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

const ICON: Record<Diagnostic["severity"], string> = {
  error: "⛔",
  warn: "⚠️",
  info: "ℹ️",
};

export function DiagnosticsBanner({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  // Errors first, then warnings, then info.
  const order = { error: 0, warn: 1, info: 2 } as const;
  const sorted = [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((d, i) => (
        <div
          key={`${d.code}-${i}`}
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${STYLE[d.severity]}`}
        >
          <span aria-hidden>{ICON[d.severity]}</span>
          <div className="flex flex-col gap-1">
            <span>{d.message}</span>
            {d.sources?.length ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] opacity-80">
                <span className="font-medium">Sources:</span>
                {d.sources.map((s, j) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    title={s.label}
                  >
                    [{j + 1}] {s.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
