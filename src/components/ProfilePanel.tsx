import { Activity, Play } from "lucide-react";
import { useStore } from "../store";
import type { Timings } from "../lib/types";
import { formatMs } from "../lib/format";
import { Button, EmptyState, cx } from "./ui";

const RUN_COUNTS = [5, 10, 20, 50];

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-10 w-full">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-indigo-500"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-[#0f131c]">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={cx("font-mono text-sm font-semibold", accent ? "text-indigo-400" : "text-slate-700 dark:text-slate-200")}>
        {value}
      </div>
    </div>
  );
}

const PHASES: { key: keyof Timings; label: string; color: string }[] = [
  { key: "dnsMs", label: "DNS", color: "bg-indigo-500" },
  { key: "tcpMs", label: "TCP", color: "bg-sky-500" },
  { key: "tlsMs", label: "TLS", color: "bg-violet-500" },
  { key: "ttfbMs", label: "Wait", color: "bg-amber-500" },
  { key: "downloadMs", label: "Download", color: "bg-emerald-500" },
];

export function ProfilePanel() {
  const profile = useStore((s) => s.profile);
  const runProfile = useStore((s) => s.runProfile);

  const results = profile?.results ?? [];
  const totals = results.map((r) => r.totalMs);
  const sorted = [...totals].sort((a, b) => a - b);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;

  const avgPhase = (k: keyof Timings) =>
    results.length ? results.reduce((a, r) => a + r[k], 0) / results.length : 0;
  const phaseAverages = PHASES.map((p) => ({ ...p, ms: avgPhase(p.key) }));
  const phaseSum = phaseAverages.reduce((a, p) => a + p.ms, 0) || 1;

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Run the request</span>
        {RUN_COUNTS.map((n) => (
          <Button
            key={n}
            variant="subtle"
            className="px-3 py-1 text-xs"
            disabled={profile?.running}
            onClick={() => runProfile(n)}
          >
            ×{n}
          </Button>
        ))}
        {profile?.running && (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <Play size={12} className="animate-pulse text-indigo-500" />
            {profile.done}/{profile.total}
          </span>
        )}
      </div>

      {results.length === 0 && !profile?.running && (
        <EmptyState
          icon={<Activity size={36} strokeWidth={1.3} />}
          title="Latency profiler"
          subtitle="Fire the current request multiple times to see its timing distribution (p50 / p95) and average per-phase breakdown."
        />
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <Stat label="p50" value={formatMs(percentile(sorted, 50))} accent />
            <Stat label="p95" value={formatMs(percentile(sorted, 95))} accent />
            <Stat label="min" value={formatMs(sorted[0] ?? 0)} />
            <Stat label="max" value={formatMs(sorted[sorted.length - 1] ?? 0)} />
            <Stat label="avg" value={formatMs(avg)} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-[#0f131c]">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Per-run total ({results.length} runs)
            </div>
            <Sparkline values={totals} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-[#0f131c]">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Average phase breakdown
            </div>
            <div className="flex h-6 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-white/[0.04]">
              {phaseAverages
                .filter((p) => p.ms > 0)
                .map((p) => (
                  <div
                    key={p.label}
                    className={cx(p.color, "h-full")}
                    style={{ width: `${(p.ms / phaseSum) * 100}%` }}
                    title={`${p.label}: ${formatMs(p.ms)}`}
                  />
                ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {phaseAverages.map((p) => (
                <div key={p.label} className="flex items-center gap-2 text-xs">
                  <span className={cx("h-2.5 w-2.5 rounded-full", p.color)} />
                  <span className="text-slate-500 dark:text-slate-400">{p.label}</span>
                  <span className="ml-auto font-mono text-slate-700 dark:text-slate-200">
                    {formatMs(p.ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
