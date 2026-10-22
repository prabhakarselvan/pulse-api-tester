import { useState } from "react";
import { Activity, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useStore, type Monitor, type MonitorResult } from "../store";
import { formatMs, statusColor, timeAgo } from "../lib/format";
import { IconButton, cx } from "./ui";

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-5" />;
  const w = 80;
  const h = 20;
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
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-5 w-20 text-indigo-500">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function certColor(days: number): string {
  if (days < 0) return "text-rose-500";
  if (days < 14) return "text-rose-500";
  if (days < 30) return "text-amber-500";
  return "text-slate-400";
}

export function MonitorsPanel() {
  const monitors = useStore((s) => s.monitors);
  const results = useStore((s) => s.monitorResults);
  const addMonitor = useStore((s) => s.addMonitor);
  const removeMonitor = useStore((s) => s.removeMonitor);
  const checkMonitor = useStore((s) => s.checkMonitor);
  const [url, setUrl] = useState("");

  const add = () => {
    if (url.trim()) {
      addMonitor(url.trim());
      setUrl("");
    }
  };

  return (
    <div className="space-y-2 p-2">
      <div className="flex gap-1.5">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="https://api.example.com/health"
          spellCheck={false}
          className="no-drag min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200"
        />
        <IconButton onClick={add} title="Add monitor">
          <Plus size={14} />
        </IconButton>
      </div>

      {monitors.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <Activity size={26} strokeWidth={1.3} className="mb-2 text-slate-300 dark:text-slate-600" />
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300">No monitors</div>
          <div className="mt-1 max-w-[13rem] text-[11px] text-slate-400 dark:text-slate-500">
            Add an endpoint to track its uptime, latency, and TLS certificate expiry — re-checked
            every minute while Pulse is open.
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {monitors.map((m) => (
            <MonitorRow
              key={m.id}
              monitor={m}
              result={results[m.id]}
              onRemove={() => removeMonitor(m.id)}
              onCheck={() => checkMonitor(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonitorRow({
  monitor,
  result,
  onRemove,
  onCheck,
}: {
  monitor: Monitor;
  result?: MonitorResult;
  onRemove: () => void;
  onCheck: () => void;
}) {
  const dot = !result ? "bg-slate-300 dark:bg-slate-600" : result.ok ? "bg-emerald-500" : "bg-rose-500";

  return (
    <div className="group rounded-lg border border-slate-200 bg-white p-2 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <span className={cx("h-2 w-2 shrink-0 rounded-full", dot)} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700 dark:text-slate-200"
          title={monitor.url}
        >
          {monitor.url.replace(/^https?:\/\//, "")}
        </span>
        <IconButton onClick={onCheck} title="Check now" className="opacity-0 group-hover:opacity-100">
          <RefreshCw size={12} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" className="opacity-0 group-hover:opacity-100">
          <Trash2 size={12} />
        </IconButton>
      </div>

      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
        {result ? (
          <>
            <span className={cx("font-mono font-semibold", result.ok ? statusColor(result.status ?? 0) : "text-rose-500")}>
              {result.error ? "DOWN" : (result.status ?? "—")}
            </span>
            {!result.error && (
              <span className="font-mono text-slate-500 dark:text-slate-400">
                {formatMs(result.latencyMs)}
              </span>
            )}
            {result.certExpiryDays != null && (
              <span className={cx("font-mono", certColor(result.certExpiryDays))} title="TLS certificate expiry">
                cert {result.certExpiryDays}d
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Spark values={result.history} />
              <span className="text-[10px] text-slate-400">{timeAgo(result.checkedAt)}</span>
            </div>
          </>
        ) : (
          <span className="text-slate-400">checking…</span>
        )}
      </div>
      {result?.error && (
        <div className="mt-1 truncate text-[10px] text-rose-500" title={result.error}>
          {result.error}
        </div>
      )}
    </div>
  );
}
