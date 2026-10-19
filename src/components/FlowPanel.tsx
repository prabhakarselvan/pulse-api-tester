import { useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Hourglass,
  Laptop,
  RotateCw,
  Server,
} from "lucide-react";
import type { HttpResponse } from "../lib/types";
import { formatMs } from "../lib/format";
import { Button, cx } from "./ui";

type Dir = "req" | "resp" | "both" | "wait";

interface Step {
  key: string;
  label: string;
  sub: string;
  ms: number;
  bar: string;
  text: string;
  dir: Dir;
}

function DirIcon({ dir, className }: { dir: Dir; className?: string }) {
  const p = { size: 15, className };
  if (dir === "req") return <ArrowRight {...p} />;
  if (dir === "resp") return <ArrowLeft {...p} />;
  if (dir === "wait") return <Hourglass {...p} />;
  return <ArrowLeftRight {...p} />;
}

export function FlowPanel({ res }: { res: HttpResponse }) {
  const [playKey, setPlayKey] = useState(0);
  const t = res.timings;

  const steps: Step[] = [];
  if (t.dnsMs > 0)
    steps.push({
      key: "dns",
      label: "DNS lookup",
      sub: `resolve host → ${res.network.dns.usedAddress ?? "IP"}`,
      ms: t.dnsMs,
      bar: "bg-indigo-500",
      text: "text-indigo-400",
      dir: "both",
    });
  if (t.tcpMs > 0)
    steps.push({
      key: "tcp",
      label: "TCP connect",
      sub: "open the connection (handshake)",
      ms: t.tcpMs,
      bar: "bg-sky-500",
      text: "text-sky-400",
      dir: "both",
    });
  if (t.tlsMs > 0)
    steps.push({
      key: "tls",
      label: "TLS handshake",
      sub: "negotiate encryption",
      ms: t.tlsMs,
      bar: "bg-violet-500",
      text: "text-violet-400",
      dir: "both",
    });
  steps.push({
    key: "wait",
    label: "Server processing",
    sub: "request sent — waiting for first byte",
    ms: t.ttfbMs,
    bar: "bg-amber-500",
    text: "text-amber-400",
    dir: "wait",
  });
  steps.push({
    key: "download",
    label: "Download",
    sub: "receiving the response body",
    ms: t.downloadMs,
    bar: "bg-emerald-500",
    text: "text-emerald-400",
    dir: "resp",
  });

  // Compress real durations into a ~2.8s animation; each phase gets a floor so
  // tiny phases are still visible. Delays accumulate so phases play in sequence.
  const ANIM = 2800;
  const sumMs = Math.max(1, steps.reduce((a, s) => a + Math.max(s.ms, 0), 0));
  let acc = 0;
  const timed = steps.map((s) => {
    const dur = Math.max(420, (Math.max(s.ms, 0) / sumMs) * ANIM);
    const delay = acc;
    acc += dur;
    return { ...s, dur, delay };
  });
  const totalDur = acc;

  const dominant = steps.reduce((m, s) => (s.ms > m.ms ? s : m), steps[0]);
  const pct = t.totalMs > 0 ? Math.round((dominant.ms / t.totalMs) * 100) : 0;

  return (
    <div className="h-full space-y-5 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Request flow
        </div>
        <Button variant="subtle" className="text-xs" onClick={() => setPlayKey((k) => k + 1)}>
          <RotateCw size={13} /> Replay
        </Button>
      </div>

      {/* Connection wire with a travelling packet */}
      <div key={`wire-${playKey}`} className="flex items-center gap-3">
        <Endpoint icon={<Laptop size={16} />} label="You" />
        <div className="relative flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
          {timed.map((s) => (
            <div
              key={s.key}
              className={cx(s.bar, "h-full")}
              style={{ width: `${(Math.max(s.ms, 0) / sumMs) * 100}%` }}
            />
          ))}
          <span
            className="dot-travel absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-indigo-400"
            style={{ animationDuration: `${totalDur}ms` }}
          />
        </div>
        <Endpoint icon={<Server size={16} />} label="Server" right />
      </div>

      {/* Phase-by-phase journey */}
      <div key={`steps-${playKey}`} className="space-y-2.5">
        {timed.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <div className="flex w-6 shrink-0 justify-center">
              <DirIcon dir={s.dir} className={s.text} />
            </div>
            <div className="w-36 shrink-0">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {s.label}
              </div>
              <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                {s.sub}
              </div>
            </div>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-white/[0.05]">
              {s.dir === "wait" ? (
                <div
                  className="wait-pulse absolute inset-0 flex items-center gap-1.5 px-2 text-[11px] font-medium text-amber-500"
                  style={{
                    animationDelay: `${s.delay}ms`,
                    animationDuration: "1300ms",
                    animationIterationCount: "infinite",
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgba(245,158,11,0.12) 0 8px, transparent 8px 16px)",
                  }}
                >
                  <Hourglass size={12} /> waiting for server…
                </div>
              ) : (
                <div
                  className={cx(
                    "flow-grow relative h-full",
                    s.bar,
                    s.dir === "resp" && "flow-grow-right",
                  )}
                  style={{ animationDelay: `${s.delay}ms`, animationDuration: `${s.dur}ms` }}
                >
                  <div
                    className="flow-shimmer absolute inset-0"
                    style={{ animationDelay: `${s.delay}ms` }}
                  />
                </div>
              )}
            </div>
            <div className={cx("w-16 shrink-0 text-right font-mono text-xs font-semibold", s.text)}>
              {formatMs(s.ms)}
            </div>
          </div>
        ))}
      </div>

      {/* Insight */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-white/[0.08] dark:bg-[#0f131c]">
        <span className="text-slate-500 dark:text-slate-400">
          Most of the time —{" "}
          <span className={cx("font-semibold", dominant.text)}>
            {pct}% ({formatMs(dominant.ms)})
          </span>{" "}
          — was spent on <span className="font-medium text-slate-700 dark:text-slate-200">{dominant.label.toLowerCase()}</span>.
        </span>{" "}
        <span className="text-slate-400 dark:text-slate-500">
          {dominant.key === "wait"
            ? "That's the server thinking before it sent the first byte — latency is on their side, not the network."
            : dominant.key === "tls"
              ? "The encryption handshake dominated — often a sign of a proxy or a distant server."
              : dominant.key === "dns"
                ? "Name resolution dominated — a slow or cold DNS resolver."
                : dominant.key === "download"
                  ? "Transferring the body dominated — a large response or a slow link."
                  : "Establishing the connection dominated."}
        </span>
        <div className="mt-2 font-mono text-[11px] text-slate-400">
          total round-trip: {formatMs(t.totalMs)} · {res.network.connection.httpVersion}
        </div>
      </div>
    </div>
  );
}

function Endpoint({
  icon,
  label,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  right?: boolean;
}) {
  return (
    <div className={cx("flex shrink-0 flex-col items-center gap-0.5", right ? "order-last" : "")}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
        {icon}
      </div>
      <span className="text-[10px] text-slate-400">{label}</span>
    </div>
  );
}
