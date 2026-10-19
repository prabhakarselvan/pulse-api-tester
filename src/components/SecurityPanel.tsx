import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { HttpResponse } from "../lib/types";
import { analyzeSecurity, type CheckStatus } from "../lib/security";
import { cx } from "./ui";

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-500 border-emerald-500/40 bg-emerald-500/10";
  if (grade.startsWith("B")) return "text-indigo-400 border-indigo-400/40 bg-indigo-400/10";
  if (grade.startsWith("C")) return "text-amber-500 border-amber-500/40 bg-amber-500/10";
  if (grade.startsWith("D")) return "text-orange-500 border-orange-500/40 bg-orange-500/10";
  return "text-rose-500 border-rose-500/40 bg-rose-500/10";
}

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case "pass":
      return <CheckCircle2 size={15} className="text-emerald-500" />;
    case "warn":
      return <AlertTriangle size={15} className="text-amber-500" />;
    case "fail":
      return <XCircle size={15} className="text-rose-500" />;
    default:
      return <Info size={15} className="text-slate-400" />;
  }
}

export function SecurityPanel({ res }: { res: HttpResponse }) {
  const report = analyzeSecurity(res);
  const counts = report.checks.reduce(
    (a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a),
    {} as Record<CheckStatus, number>,
  );

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {/* Grade header */}
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/[0.08] dark:bg-[#0f131c]">
        <div
          className={cx(
            "flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border text-3xl font-bold",
            gradeColor(report.grade),
          )}
        >
          {report.grade}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Security score: {report.score}/100
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className="text-emerald-500">{counts.pass ?? 0} passed</span>
            <span className="text-amber-500">{counts.warn ?? 0} warnings</span>
            <span className="text-rose-500">{counts.fail ?? 0} failed</span>
            <span className="text-slate-400">{counts.info ?? 0} info</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            Based on TLS, certificate, security headers and cookie flags.
          </div>
        </div>
      </div>

      {/* Checks */}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
        {report.checks.map((c) => (
          <div
            key={c.id}
            className="flex gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0 dark:border-white/[0.05]"
          >
            <div className="mt-0.5 shrink-0">
              <StatusIcon status={c.status} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.label}</div>
              <div className="mt-0.5 break-words text-[11px] text-slate-500 dark:text-slate-400">
                {c.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
