import { useState } from "react";
import { Activity, Play } from "lucide-react";
import { useStore } from "../store";
import type { Timings } from "../lib/types";
import { formatMs } from "../lib/format";
import { Button, EmptyState, cx } from "./ui";

const RUN_COUNTS = [10, 25, 50, 100];
const CONCURRENCY = [1, 4, 8, 16];

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function Histogram({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const bins = 14;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.floor(((v - min) / span) * bins));
    counts[b]++;
  }
  const maxC = Math.max(...counts, 1);
  return (
    <div>
      <div className="flex h-24 items-end gap-0.5">
        {counts.map((c, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-indigo-500/70 transition-all hover:bg-indigo-500"
            style={{ height: `${Math.max(2, (c / maxC) * 100)}%` }}
            title={`${formatMs(min + (i / bins) * span)} – ${formatMs(
              min + ((i + 1) / bins) * span,
            )}: ${c} run${c === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
        <span>{formatMs(min)}</span>
        <span>{formatMs(max)}</span>
      </div>
    </div>
  );
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
  const [concurrency, setConcurrency] = useState(1);

  const results = profile?.results ?? [];
  const totals = results.map((r) => r.totalMs);
  const sorted = [...totals].sort((a, b) => a - b);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const durationMs = profile?.durationMs ?? 0;
  const completed = (profile?.done ?? 0);
  const rps = durationMs > 0 ? (completed / (durationMs / 1000)) : 0;
  const errors = profile?.errors ?? 0;
  const statusDist = (profile?.statuses ?? []).reduce(
    (a, s) => ((a[s] = (a[s] ?? 0) + 1), a),
    {} as Record<number, number>,
  );

  const avgPhase = (k: keyof Timings) =>
    results.length ? results.reduce((a, r) => a + r[k], 0) / results.length : 0;
  const phaseAverages = PHASES.map((p) => ({ ...p, ms: avgPhase(p.key) }));
  const phaseSum = phaseAverages.reduce((a, p) => a + p.ms, 0) || 1;

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {/* Controls */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-slate-500 dark:text-slate-400">
            Concurrency
          </span>
          {CONCURRENCY.map((c) => (
            <Button
              key={c}
              variant={concurrency === c ? "primary" : "subtle"}
              className="px-3 py-1 text-xs"
              disabled={profile?.running}
              onClick={() => setConcurrency(c)}
            >
              ×{c}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-xs font-medium text-slate-500 dark:text-slate-400">
            Fire requests
          </span>
          {RUN_COUNTS.map((n) => (
            <Button
              key={n}
              variant="subtle"
              className="px-3 py-1 text-xs"
              disabled={profile?.running}
              onClick={() => runProfile(n, concurrency)}
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
      </div>

      {results.length === 0 && !profile?.running && (
        <EmptyState
          icon={<Activity size={36} strokeWidth={1.3} />}
          title="Load tester"
          subtitle="Fire the current request N times (optionally concurrent) to see its latency distribution (p50 / p95 / p99), throughput, a histogram, and the per-phase breakdown."
        />
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Stat label="p50" value={formatMs(percentile(sorted, 50))} accent />
            <Stat label="p90" value={formatMs(percentile(sorted, 90))} accent />
            <Stat label="p95" value={formatMs(percentile(sorted, 95))} accent />
            <Stat label="p99" value={formatMs(percentile(sorted, 99))} accent />
            <Stat label="min" value={formatMs(sorted[0] ?? 0)} />
            <Stat label="max" value={formatMs(sorted[sorted.length - 1] ?? 0)} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="avg" value={formatMs(avg)} />
            <Stat label="throughput" value={`${rps.toFixed(1)}/s`} accent />
            <Stat label="wall time" value={formatMs(durationMs)} />
            <Stat
              label="success"
              value={`${results.length}/${(profile?.total ?? 0)}${errors ? ` · ${errors} err` : ""}`}
            />
          </div>

          {Object.keys(statusDist).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(statusDist)
                .sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([code, count]) => (
                  <span
                    key={code}
                    className={cx(
                      "rounded px-2 py-0.5 font-mono text-[11px]",
                      Number(code) < 400
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                        : "bg-rose-500/15 text-rose-500",
                    )}
                  >
                    {code} ×{count}
                  </span>
                ))}
              {errors > 0 && (
                <span className="rounded bg-rose-500/15 px-2 py-0.5 font-mono text-[11px] text-rose-500">
                  error ×{errors}
                </span>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-[#0f131c]">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Latency distribution ({results.length} runs)
            </div>
            <Histogram values={totals} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-[#0f131c]">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Per-run total (in order)
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
