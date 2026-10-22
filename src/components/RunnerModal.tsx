import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { useStore } from "../store";
import { formatMs, methodColor, statusColor } from "../lib/format";
import { Panel, cx } from "./ui";

export function RunnerModal() {
  const runner = useStore((s) => s.runnerState);
  const close = useStore((s) => s.closeRunner);
  if (!runner) return null;

  const passed = runner.results.filter((r) => r.ok).length;
  const failed = runner.results.filter((r) => !r.ok).length;
  const totalTime = runner.results.reduce((a, r) => a + r.timeMs, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <Panel className="flex max-h-[80vh] w-[40rem] max-w-[92vw] flex-col p-0 shadow-2xl">
        <div onClick={(e) => e.stopPropagation()} className="flex min-h-0 flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/[0.08]">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                Run · {runner.collectionName}
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-xs">
                {runner.running ? (
                  <span className="flex items-center gap-1.5 text-indigo-500">
                    <Loader2 size={12} className="animate-spin" />
                    {runner.done}/{runner.total}
                  </span>
                ) : (
                  <span className="text-slate-400">
                    {runner.total} request{runner.total === 1 ? "" : "s"} · {formatMs(totalTime)}
                  </span>
                )}
                <span className="text-emerald-500">{passed} passed</span>
                {failed > 0 && <span className="text-rose-500">{failed} failed</span>}
              </div>
            </div>
            <button
              onClick={close}
              className="no-drag ml-auto rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.06]"
            >
              <X size={16} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-0.5 w-full bg-slate-100 dark:bg-white/[0.06]">
            <div
              className={cx("h-full transition-all", failed > 0 ? "bg-rose-500" : "bg-emerald-500")}
              style={{ width: `${runner.total ? (runner.done / runner.total) * 100 : 0}%` }}
            />
          </div>

          {/* Results */}
          <div className="min-h-0 flex-1 overflow-auto">
            {runner.results.length === 0 && !runner.running && (
              <div className="p-6 text-center text-xs text-slate-400">
                This collection has no requests to run.
              </div>
            )}
            {runner.results.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b border-slate-100 px-4 py-2 text-xs last:border-0 dark:border-white/[0.05]"
              >
                {r.ok ? (
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                ) : (
                  <XCircle size={15} className="shrink-0 text-rose-500" />
                )}
                <span className={cx("w-14 shrink-0 font-mono text-[10px] font-bold", methodColor(r.method))}>
                  {r.method}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200" title={r.name}>
                  {r.name}
                </span>
                {r.error ? (
                  <span className="max-w-[12rem] truncate text-rose-500" title={r.error}>
                    {r.error}
                  </span>
                ) : (
                  <>
                    {(r.testsPassed > 0 || r.testsFailed > 0) && (
                      <span className="font-mono text-[10px]">
                        <span className="text-emerald-500">{r.testsPassed}✓</span>
                        {r.testsFailed > 0 && <span className="ml-1 text-rose-500">{r.testsFailed}✗</span>}
                      </span>
                    )}
                    <span className={cx("w-10 shrink-0 text-right font-mono font-semibold", statusColor(r.status ?? 0))}>
                      {r.status ?? "—"}
                    </span>
                  </>
                )}
                <span className="w-14 shrink-0 text-right font-mono text-slate-400">
                  {formatMs(r.timeMs)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-white/[0.08]">
            Variables set by a request's post-response script flow into later
            requests in the run.
          </div>
        </div>
      </Panel>
    </div>
  );
}
