import { CheckCircle2, FlaskConical, Terminal, XCircle } from "lucide-react";
import { useStore } from "../store";
import { EmptyState, cx } from "./ui";

export function TestsPanel() {
  const tests = useStore((s) => s.testResults);
  const logs = useStore((s) => s.scriptLogs);

  if (tests.length === 0 && logs.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical size={38} strokeWidth={1.3} />}
        title="No tests ran"
        subtitle="Add a Post-response script in the Scripts tab (e.g. pm.test(...)) to assert on the response."
      />
    );
  }

  const passed = tests.filter((t) => t.passed).length;
  const failed = tests.length - passed;

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {tests.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium text-emerald-500">{passed} passed</span>
            {failed > 0 && <span className="font-medium text-rose-500">{failed} failed</span>}
            <span className="text-slate-400">of {tests.length}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
            {tests.map((t, i) => (
              <div
                key={i}
                className="flex gap-2 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-white/[0.05]"
              >
                {t.passed ? (
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle size={15} className="mt-0.5 shrink-0 text-rose-500" />
                )}
                <div className="min-w-0">
                  <div
                    className={cx(
                      "text-xs",
                      t.passed ? "text-slate-700 dark:text-slate-200" : "text-rose-500",
                    )}
                  >
                    {t.name}
                  </div>
                  {!t.passed && t.error && (
                    <div className="mt-0.5 break-words font-mono text-[11px] text-slate-400">
                      {t.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {logs.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Terminal size={12} /> Console
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
            {logs.map((l, i) => (
              <div
                key={i}
                className={cx(
                  "border-b border-slate-100 px-3 py-1.5 font-mono text-[11px] last:border-0 dark:border-white/[0.05]",
                  l.level === "error"
                    ? "text-rose-500"
                    : l.level === "warn"
                      ? "text-amber-500"
                      : "text-slate-600 dark:text-slate-300",
                )}
              >
                {l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
