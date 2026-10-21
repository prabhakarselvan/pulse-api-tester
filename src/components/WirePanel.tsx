import { useMemo, useState } from "react";
import { Check, Copy, Lock, Network, ShieldOff } from "lucide-react";
import type { HttpResponse } from "../lib/types";
import { formatBytes } from "../lib/format";
import { EmptyState, IconButton, Segmented, cx, type SegOption } from "./ui";

type WireView = "decoded" | "encrypted" | "h2";

export function WirePanel({ res }: { res: HttpResponse }) {
  const [view, setView] = useState<WireView>("decoded");
  const views: SegOption<WireView>[] = [
    { value: "decoded", label: "Decoded" },
    { value: "encrypted", label: "Encrypted" },
    { value: "h2", label: "HTTP/2 frames" },
  ];

  const responseText =
    res.rawResponseHead +
    "\r\n" +
    (res.body || (res.bodyBase64 ? `<${res.bodySizeBytes} bytes of binary data>` : ""));

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Segmented options={views} value={view} onChange={setView} />
      {view === "decoded" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <RawBlock title="Request" text={res.rawRequest} />
          <RawBlock title="Response" text={responseText} />
        </div>
      ) : view === "encrypted" ? (
        <EncryptedView res={res} />
      ) : (
        <H2View res={res} />
      )}
    </div>
  );
}

function RawBlock({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <IconButton onClick={copy} aria-label="Copy">
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </IconButton>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-white/[0.08] dark:bg-[#0f131c] dark:text-slate-300">
        {text || "—"}
      </pre>
    </div>
  );
}

function EncryptedView({ res }: { res: HttpResponse }) {
  const tls = res.network.tls;

  if (!tls) {
    return (
      <EmptyState
        icon={<ShieldOff size={40} strokeWidth={1.3} />}
        title="No TLS — traffic is plaintext"
        subtitle="This request used plain HTTP, so there is no encryption layer. The bytes on the wire are exactly the decoded request/response."
      />
    );
  }

  const captured = res.tlsTxB64 || res.tlsRxB64;
  if (!captured) {
    return (
      <EmptyState
        icon={<Lock size={40} strokeWidth={1.3} />}
        title="Ciphertext not captured"
        subtitle="Encrypted bytes are recorded during a fresh TLS handshake. This request reused a pooled keep-alive connection, so turn off Keep-alive to capture the wire ciphertext."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-300/50 bg-emerald-50 px-3 py-2 dark:border-emerald-500/20 dark:bg-emerald-500/10">
        <Lock size={13} className="shrink-0 text-emerald-500" />
        <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
          Application data encrypted under{" "}
          <span className="font-mono font-semibold">{tls.version || "TLS"}</span>
          {tls.cipherSuite && (
            <>
              {" · "}
              <span className="font-mono font-semibold">{tls.cipherSuite}</span>
            </>
          )}
          . These are the TLS records after the handshake — the ciphertext a network
          sniffer would see.
        </span>
      </div>
      <EncBlock title="Sent — encrypted request" b64={res.tlsTxB64} total={res.tlsTxTotal} />
      <EncBlock title="Received — encrypted response" b64={res.tlsRxB64} total={res.tlsRxTotal} />
    </div>
  );
}

const RECORD_NAMES: Record<number, string> = {
  20: "change_cipher_spec",
  21: "alert",
  22: "handshake",
  23: "application_data",
  24: "heartbeat",
};

interface TlsRecord {
  type: number;
  name: string;
  length: number;
}

function parseTlsRecords(bytes: Uint8Array): TlsRecord[] {
  const recs: TlsRecord[] = [];
  let i = 0;
  while (i + 5 <= bytes.length) {
    const type = bytes[i];
    const major = bytes[i + 1];
    // Valid TLS record: content type 20–24, legacy_record_version major == 3.
    if (type < 20 || type > 24 || major !== 3) break;
    const len = (bytes[i + 3] << 8) | bytes[i + 4];
    recs.push({ type, name: RECORD_NAMES[type] ?? `0x${type.toString(16)}`, length: len });
    i += 5 + len;
    if (recs.length > 4096) break;
  }
  return recs;
}

function b64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    let hex = "";
    let ascii = "";
    for (let j = off; j < off + 16; j++) {
      if (j < bytes.length) {
        hex += bytes[j].toString(16).padStart(2, "0") + " ";
        const c = bytes[j];
        ascii += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".";
      } else {
        hex += "   ";
      }
      if (j === off + 7) hex += " ";
    }
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex} |${ascii}|`);
  }
  return lines.join("\n");
}

// --- HTTP/2 frame inspector ------------------------------------------------

const H2_PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
const FRAME_TYPES: Record<number, string> = {
  0: "DATA",
  1: "HEADERS",
  2: "PRIORITY",
  3: "RST_STREAM",
  4: "SETTINGS",
  5: "PUSH_PROMISE",
  6: "PING",
  7: "GOAWAY",
  8: "WINDOW_UPDATE",
  9: "CONTINUATION",
};

interface H2Frame {
  type: number;
  name: string;
  streamId: number;
  length: number;
  flagNames: string[];
}

function frameFlags(type: number, flags: number): string[] {
  const out: string[] = [];
  if ((type === 0 || type === 1) && flags & 0x1) out.push("END_STREAM");
  if ((type === 1 || type === 9) && flags & 0x4) out.push("END_HEADERS");
  if ((type === 0 || type === 1) && flags & 0x8) out.push("PADDED");
  if (type === 1 && flags & 0x20) out.push("PRIORITY");
  if ((type === 4 || type === 6) && flags & 0x1) out.push("ACK");
  return out;
}

function parseH2Frames(bytes: Uint8Array): { frames: H2Frame[]; preface: boolean } {
  let i = 0;
  let preface = false;
  if (bytes.length >= 24) {
    try {
      if (new TextDecoder().decode(bytes.subarray(0, 24)) === H2_PREFACE) {
        preface = true;
        i = 24;
      }
    } catch {
      /* ignore */
    }
  }
  const frames: H2Frame[] = [];
  while (i + 9 <= bytes.length) {
    const length = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    const type = bytes[i + 3];
    const flags = bytes[i + 4];
    const streamId =
      ((bytes[i + 5] & 0x7f) << 24) | (bytes[i + 6] << 16) | (bytes[i + 7] << 8) | bytes[i + 8];
    frames.push({
      type,
      name: FRAME_TYPES[type] ?? `UNKNOWN(${type})`,
      streamId,
      length,
      flagNames: frameFlags(type, flags),
    });
    i += 9 + length;
    if (frames.length > 4096) break;
  }
  return { frames, preface };
}

function frameColor(type: number): string {
  switch (type) {
    case 1: // HEADERS
    case 9: // CONTINUATION
      return "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300";
    case 0: // DATA
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
    case 3: // RST_STREAM
    case 7: // GOAWAY
      return "bg-rose-500/15 text-rose-500";
    case 6: // PING
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:
      return "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400";
  }
}

function H2View({ res }: { res: HttpResponse }) {
  const httpVer = res.network.connection.httpVersion;
  if (!httpVer.includes("2")) {
    return (
      <EmptyState
        icon={<Network size={40} strokeWidth={1.3} />}
        title="HTTP/2 not negotiated"
        subtitle={`This connection used ${httpVer || "HTTP/1.1"}. HTTP/2 framing is shown only when the server negotiates h2 over ALPN.`}
      />
    );
  }
  if (!res.h2TxB64 && !res.h2RxB64) {
    return (
      <EmptyState
        icon={<Network size={40} strokeWidth={1.3} />}
        title="Frames not captured"
        subtitle="HTTP/2 frames are recorded on a fresh connection. This request reused a pooled keep-alive connection — turn off Keep-alive to capture the frames."
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div className="flex items-center gap-2 rounded-lg border border-indigo-300/50 bg-indigo-50 px-3 py-2 dark:border-indigo-500/20 dark:bg-indigo-500/10">
        <Network size={13} className="shrink-0 text-indigo-500" />
        <span className="text-[11px] text-indigo-700 dark:text-indigo-300">
          Decrypted HTTP/2 frames — one layer above the ciphertext. HEADERS carry the
          (HPACK-compressed) request/response headers; DATA carries the body.
        </span>
      </div>
      <H2Block title="Sent — client → server" b64={res.h2TxB64} total={res.h2TxTotal} />
      <H2Block title="Received — server → client" b64={res.h2RxB64} total={res.h2RxTotal} />
    </div>
  );
}

function H2Block({ title, b64, total }: { title: string; b64: string; total: number }) {
  const bytes = useMemo(() => b64ToBytes(b64), [b64]);
  const { frames, preface } = useMemo(() => parseH2Frames(bytes), [bytes]);
  const truncated = total > bytes.length;

  if (!b64) {
    return (
      <div className="flex flex-col">
        <span className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div className="rounded-lg border border-slate-200 p-3 text-[11px] text-slate-400 dark:border-white/[0.08]">
          No frames captured in this direction.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <span className="font-mono text-[10px] text-slate-400">
          {frames.length} frame{frames.length === 1 ? "" : "s"}
          {truncated && ` · first ${formatBytes(bytes.length)} of ${formatBytes(total)}`}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/[0.08]">
        {preface && (
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 font-mono text-[10px] text-slate-500 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-slate-400">
            connection preface (PRI * HTTP/2.0)
          </div>
        )}
        {frames.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[11px] last:border-0 dark:border-white/[0.05]"
          >
            <span className={cx("rounded px-1.5 py-0.5 font-mono font-semibold", frameColor(f.type))}>
              {f.name}
            </span>
            <span className="font-mono text-slate-400">
              stream {f.streamId}
            </span>
            <span className="font-mono text-slate-500 dark:text-slate-300">{f.length} B</span>
            <div className="ml-auto flex flex-wrap gap-1">
              {f.flagNames.map((fn) => (
                <span
                  key={fn}
                  className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[9px] text-slate-500 dark:bg-white/10 dark:text-slate-400"
                >
                  {fn}
                </span>
              ))}
            </div>
          </div>
        ))}
        {frames.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-slate-400">
            No complete frames in the captured sample.
          </div>
        )}
      </div>
    </div>
  );
}

function EncBlock({ title, b64, total }: { title: string; b64: string; total: number }) {
  const bytes = useMemo(() => b64ToBytes(b64), [b64]);
  const records = useMemo(() => parseTlsRecords(bytes), [bytes]);
  const dump = useMemo(() => hexDump(bytes), [bytes]);
  const [copied, setCopied] = useState(false);

  const appData = records.filter((r) => r.type === 23);
  const appBytes = appData.reduce((a, r) => a + r.length, 0);
  const truncated = total > bytes.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dump);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!b64) {
    return (
      <div className="flex min-h-0 flex-col">
        <span className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div className="rounded-lg border border-slate-200 p-3 text-[11px] text-slate-400 dark:border-white/[0.08]">
          No bytes captured in this direction.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-400">
            {records.length} record{records.length === 1 ? "" : "s"}
            {appData.length > 0 && ` · ${formatBytes(appBytes)} app-data`}
            {truncated && ` · first ${formatBytes(bytes.length)} of ${formatBytes(total)}`}
          </span>
          <IconButton onClick={copy} aria-label="Copy hex">
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </IconButton>
        </div>
      </div>
      {records.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 px-1">
          {records.slice(0, 24).map((r, i) => (
            <span
              key={i}
              className={cx(
                "rounded px-1.5 py-0.5 font-mono text-[9px]",
                r.type === 23
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400",
              )}
              title={`TLS record: ${r.name}, ${r.length} bytes`}
            >
              {r.name} · {r.length}
            </span>
          ))}
          {records.length > 24 && (
            <span className="px-1 py-0.5 text-[9px] text-slate-400">+{records.length - 24} more</span>
          )}
        </div>
      )}
      <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-white/[0.08] dark:bg-[#0f131c] dark:text-slate-300">
        {dump || "—"}
      </pre>
    </div>
  );
}
