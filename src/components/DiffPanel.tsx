import { useMemo } from "react";
import { GitCompare, Pin, PinOff, X } from "lucide-react";
import { useStore } from "../store";
import type { HttpResponse } from "../lib/types";
import { detectLang, formatBytes, formatMs, maybePretty, statusColor } from "../lib/format";
import { diffLines, diffStats, type DiffLine } from "../lib/diff";
import { EmptyState, cx } from "./ui";

export function DiffPanel() {
  const response = useStore((s) => s.response);
  const baseline = useStore((s) => s.diffBaseline);
  const pin = useStore((s) => s.pinDiffBaseline);
  const clear = useStore((s) => s.clearDiffBaseline);

  if (!baseline) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <EmptyState
          icon={<GitCompare size={40} strokeWidth={1.3} />}
          title="Compare two responses"
          subtitle="Pin this response as baseline A, then send again (change anything you like) to diff the next response (B) against it."
        />
        <button
          onClick={pin}
          disabled={!response}
          className="no-drag inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-40"
        >
          <Pin size={13} /> Pin current as baseline (A)
        </button>
      </div>
    );
  }

  return <DiffView baseline={baseline} current={response} onRepin={pin} onClear={clear} />;
}

function DiffView({
  baseline,
  current,
  onRepin,
  onClear,
}: {
  baseline: HttpResponse;
  current: HttpResponse | null;
  onRepin: () => void;
  onClear: () => void;
}) {
  const aText = useMemo(
    () => maybePretty(baseline.body, detectLang(baseline.contentType)),
    [baseline],
  );
  const bText = useMemo(
    () => (current ? maybePretty(current.body, detectLang(current.contentType)) : ""),
    [current],
  );
  const lines = useMemo(() => diffLines(aText, bText), [aText, bText]);
  const stats = useMemo(() => diffStats(lines), [lines]);
  const identical = current != null && stats.added === 0 && stats.removed === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Comparison header */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-200 px-4 py-2.5 dark:border-white/[0.08]">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <GitCompare size={14} /> A → B
        </span>
        <CompareChip
          label="status"
          a={`${baseline.status}`}
          b={current ? `${current.status}` : "—"}
          aClass={statusColor(baseline.status)}
          bClass={current ? statusColor(current.status) : ""}
        />
        <CompareChip
          label="time"
          a={formatMs(baseline.timings.totalMs)}
          b={current ? formatMs(current.timings.totalMs) : "—"}
        />
        <CompareChip
          label="size"
          a={formatBytes(baseline.bodySizeBytes)}
          b={current ? formatBytes(current.bodySizeBytes) : "—"}
        />
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-emerald-500">+{stats.added}</span>
          <span className="text-rose-500">−{stats.removed}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onRepin}
            title="Re-pin the current response as the new baseline (A)"
            className="no-drag inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
          >
            <PinOff size={12} /> Re-pin B as A
          </button>
          <button
            onClick={onClear}
            title="Clear baseline"
            className="no-drag inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
          >
            <X size={12} /> Clear
          </button>
        </div>
      </div>

      {/* Diff body */}
      {!current ? (
        <EmptyState
          title="Waiting for response B"
          subtitle="Send a request in this tab to compare it against the pinned baseline."
        />
      ) : identical ? (
        <EmptyState
          icon={<GitCompare size={40} strokeWidth={1.3} className="text-emerald-400" />}
          title="Identical bodies"
          subtitle="A and B have no differing lines."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <DiffRow key={i} line={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const sign = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
  return (
    <div
      className={cx(
        "flex gap-0 whitespace-pre-wrap break-words px-0",
        line.type === "add" && "bg-emerald-500/10",
        line.type === "del" && "bg-rose-500/10",
      )}
    >
      <span className="w-10 shrink-0 select-none px-1 text-right text-slate-300 dark:text-slate-600">
        {line.aLine ?? ""}
      </span>
      <span className="w-10 shrink-0 select-none px-1 text-right text-slate-300 dark:text-slate-600">
        {line.bLine ?? ""}
      </span>
      <span
        className={cx(
          "w-4 shrink-0 select-none text-center",
          line.type === "add" && "text-emerald-500",
          line.type === "del" && "text-rose-500",
          line.type === "eq" && "text-slate-300 dark:text-slate-600",
        )}
      >
        {sign}
      </span>
      <span
        className={cx(
          "flex-1 pr-3",
          line.type === "add" && "text-emerald-700 dark:text-emerald-300",
          line.type === "del" && "text-rose-700 dark:text-rose-300",
          line.type === "eq" && "text-slate-600 dark:text-slate-300",
        )}
      >
        {line.text || " "}
      </span>
    </div>
  );
}

function CompareChip({
  label,
  a,
  b,
  aClass,
  bClass,
}: {
  label: string;
  a: string;
  b: string;
  aClass?: string;
  bClass?: string;
}) {
  const changed = a !== b;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-slate-400 dark:text-slate-500">{label}</span>
      <span className={cx("font-mono", aClass)}>{a}</span>
      <span className={cx("text-slate-300 dark:text-slate-600", changed && "text-amber-500")}>
        →
      </span>
      <span className={cx("font-mono", bClass, changed && "font-semibold")}>{b}</span>
    </span>
  );
}
