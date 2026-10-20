import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, MapPin, ShieldCheck } from "lucide-react";
import type { CertInfo, HttpResponse } from "../lib/types";
import { formatBytes, formatMs, methodColor, statusColor } from "../lib/format";
import { geoLookup } from "../lib/api";
import { InfoTip, cx } from "./ui";

interface Geo {
  success?: boolean;
  failed?: boolean;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  flag?: { emoji?: string };
  connection?: { asn?: number; org?: string; isp?: string };
}

function useGeo(ip: string | null): Geo | null {
  const [geo, setGeo] = useState<Geo | null>(null);
  useEffect(() => {
    let cancelled = false;
    setGeo(null);
    if (!ip) return;
    geoLookup(ip)
      .then((txt) => {
        if (cancelled) return;
        try {
          const j = JSON.parse(txt);
          setGeo(j && j.success !== false ? j : { failed: true });
        } catch {
          setGeo({ failed: true });
        }
      })
      .catch(() => {
        if (!cancelled) setGeo({ failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [ip]);
  return geo;
}

const PHASE_TIPS = {
  dns: "DNS lookup — translating the hostname into an IP address using your system's configured resolver.",
  tcp: "TCP connect — establishing the connection (SYN / SYN-ACK / ACK handshake) with the server.",
  tls: "TLS handshake — negotiating the encrypted session: certificate exchange and key agreement.",
  wait: "Time To First Byte — from sending the request to the first response byte. Reflects server processing + round-trip.",
  download: "Download — time spent transferring the response body after the first byte arrived.",
};

export function NetworkPanel({ res }: { res: HttpResponse }) {
  const t = res.timings;
  const n = res.network;
  const geo = useGeo(n.dns.usedAddress ?? null);

  const phases = [
    { key: "dns", label: "DNS", ms: t.dnsMs, color: "bg-indigo-500", tip: PHASE_TIPS.dns },
    { key: "tcp", label: "TCP", ms: t.tcpMs, color: "bg-sky-500", tip: PHASE_TIPS.tcp },
    { key: "tls", label: "TLS", ms: t.tlsMs, color: "bg-violet-500", tip: PHASE_TIPS.tls },
    { key: "wait", label: "Wait", ms: t.ttfbMs, color: "bg-amber-500", tip: PHASE_TIPS.wait },
    { key: "download", label: "Download", ms: t.downloadMs, color: "bg-emerald-500", tip: PHASE_TIPS.download },
  ];
  const sum = phases.reduce((a, p) => a + Math.max(0, p.ms), 0) || 1;
  // A fresh connection always spends real time on TCP connect; exactly 0 ms TCP
  // alongside a real response means this request reused a keep-alive connection.
  const reused = t.tcpMs === 0 && t.dnsMs === 0 && t.ttfbMs > 0;

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {/* Timing waterfall */}
      <Section
        title="Timing"
        right={
          <span className="flex items-center gap-2">
            {reused && (
              <span
                className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500"
                title="Connection reused via keep-alive — no DNS, TCP or TLS this time."
              >
                keep-alive · reused
              </span>
            )}
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              total {formatMs(t.totalMs)}
            </span>
          </span>
        }
      >
        <div className="flex h-7 w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-white/[0.04]">
          {phases
            .filter((p) => p.ms > 0)
            .map((p) => (
              <div
                key={p.key}
                className={cx(p.color, "h-full transition-all")}
                style={{ width: `${(p.ms / sum) * 100}%`, minWidth: p.ms > 0 ? 3 : 0 }}
                title={`${p.label}: ${formatMs(p.ms)}`}
              />
            ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
          {phases.map((p) => (
            <div key={p.key} className="flex items-center gap-2 text-xs">
              <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", p.color)} />
              <span className="text-slate-500 dark:text-slate-400">{p.label}</span>
              <InfoTip text={p.tip} />
              <span className="ml-auto font-mono text-slate-700 dark:text-slate-200">
                {formatMs(p.ms)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Network hops (redirect chain + final request) */}
      <Section title={`Network hops (${n.hops.length})`}>
        <div className="space-y-1">
          {n.hops.map((h, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-4 shrink-0 text-right text-slate-400">{i + 1}</span>
              <span
                className={cx("w-12 shrink-0 font-mono text-[10px] font-bold", methodColor(h.method))}
              >
                {h.method}
              </span>
              <span className={cx("w-8 shrink-0 font-mono font-semibold", statusColor(h.status))}>
                {h.status}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-slate-500 dark:text-slate-400"
                title={h.url}
              >
                {h.url}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-slate-400">
                {formatMs(h.timings.totalMs)}
              </span>
            </div>
          ))}
        </div>
        {n.hops.length > 1 && (
          <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
            {n.hops.length - 1} redirect{n.hops.length - 1 === 1 ? "" : "s"} before the final
            response.
          </div>
        )}
      </Section>

      {/* DNS */}
      <Section title="DNS">
        <Row
          label="Resolver"
          tip="The DNS server(s) your system is configured to query (from /etc/resolv.conf)."
          value={n.dns.resolver.length ? n.dns.resolver.join(", ") : n.dns.wasIpLiteral ? "— (IP literal)" : "system default"}
        />
        <Row
          label="Resolved IPs"
          value={n.dns.addresses.length ? n.dns.addresses.join(", ") : "—"}
        />
        <Row label="Connected to" value={n.dns.usedAddress ?? "—"} />
        <Row
          label="TTL"
          tip="Time To Live — how long this DNS answer may be cached, in seconds."
          value={n.dns.ttl != null ? `${n.dns.ttl}s` : "—"}
        />
        <Row label="Lookup time" value={n.dns.wasIpLiteral ? "— (no lookup)" : formatMs(n.dns.lookupMs)} />
      </Section>

      {/* Connection */}
      <Section title="Connection">
        <Row label="Scheme" value={n.scheme.toUpperCase()} />
        <Row label="HTTP version" value={n.connection.httpVersion || "—"} />
        <Row label="Remote address" value={n.connection.remoteAddr ?? "—"} />
        <Row label="Local address" value={n.connection.localAddr ?? "—"} />
        <Row label="Request size" value={formatBytes(n.requestSizeBytes)} />
        <Row label="Response size" value={`${formatBytes(n.responseSizeBytes)} on wire · ${formatBytes(res.bodySizeBytes)} decoded`} />
      </Section>

      {/* Server location (geo / ASN) */}
      {geo && !geo.failed && (
        <Section
          title="Server location"
          right={
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <MapPin size={13} /> {geo.flag?.emoji ?? ""}
            </span>
          }
        >
          <Row
            label="Location"
            tip="Approximate geographic location of the server IP, from an IP geolocation database (ipwho.is)."
            value={
              [geo.city, geo.region, geo.country].filter(Boolean).join(", ") || "—"
            }
          />
          {geo.connection?.asn != null && (
            <Row
              label="Network (ASN)"
              tip="Autonomous System Number — the network that announces this IP, typically the hosting provider or ISP."
              value={`AS${geo.connection.asn}${geo.connection.org ? ` · ${geo.connection.org}` : ""}`}
            />
          )}
          {geo.connection?.isp && <Row label="ISP" value={geo.connection.isp} />}
          {geo.latitude != null && geo.longitude != null && (
            <Row label="Coordinates" value={`${geo.latitude}, ${geo.longitude}`} />
          )}
        </Section>
      )}

      {/* TLS */}
      {n.tls && (
        <Section
          title="TLS"
          right={
            <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
              <ShieldCheck size={13} /> secure
            </span>
          }
        >
          {n.tls.version && <Row label="Version" value={n.tls.version} />}
          {n.tls.cipherSuite && (
            <Row
              label="Cipher suite"
              tip="The set of cryptographic algorithms negotiated for this TLS session."
              value={n.tls.cipherSuite}
            />
          )}
          <Row
            label="ALPN"
            tip="Application-Layer Protocol Negotiation — how HTTP/2 vs HTTP/1.1 is chosen during the TLS handshake."
            value={n.tls.alpn ?? "—"}
          />
          <div className="mt-2 space-y-2">
            {n.tls.certificates.map((c, i) => (
              <CertCard key={i} cert={c} index={i} total={n.tls!.certificates.length} />
            ))}
          </div>
        </Section>
      )}

    </div>
  );
}

function CertCard({ cert, index, total }: { cert: CertInfo; index: number; total: number }) {
  const [open, setOpen] = useState(index === 0);
  const label = index === 0 ? "Leaf certificate" : `Chain #${index}`;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/[0.08]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="no-drag flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {cert.isCa && (
          <span className="rounded bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
            CA
          </span>
        )}
        <span className="ml-auto truncate font-mono text-slate-400">
          {total > 1 ? `${index + 1}/${total}` : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 py-2 dark:border-white/[0.05]">
          <Row label="Subject" value={cert.subject} />
          <Row label="Issuer" value={cert.issuer} />
          <Row label="Valid from" value={cert.notBefore} />
          <Row label="Valid to" value={cert.notAfter} />
          {cert.san.length > 0 && (
            <div className="flex items-start gap-2 py-1 text-xs">
              <span className="w-32 shrink-0 text-slate-500 dark:text-slate-400">
                SAN
              </span>
              <div className="flex flex-1 flex-wrap gap-1">
                {cert.san.map((s, i) => (
                  <span
                    key={i}
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Row label="Signature" value={cert.signatureAlgorithm} />
          <Row label="Serial" value={cert.serial} />
          <Row
            label="SHA-256"
            tip="SHA-256 fingerprint of the certificate — a unique identifier you can compare to verify it."
            value={cert.fingerprintSha256}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/[0.08] dark:bg-[#0f131c]">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      <span className="flex w-32 shrink-0 items-center gap-1 text-slate-500 dark:text-slate-400">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span className="flex-1 break-all font-mono text-slate-700 dark:text-slate-200">
        {value}
      </span>
    </div>
  );
}
