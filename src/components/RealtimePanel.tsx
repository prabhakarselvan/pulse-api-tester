import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Info,
  Radio,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useStore, type RtMessage, type RtStatus } from "../store";
import { formatBytes, formatMs } from "../lib/format";
import { EmptyState, cx } from "./ui";

export function RealtimePanel() {
  const rt = useStore((s) => s.rt);
  const requestMode = useStore((s) => s.requestMode);
  const rtClear = useStore((s) => s.rtClear);

  return (
    <div className="flex h-full flex-col">
      <StatusHeader status={rt.status} protocol={rt.protocol || (requestMode === "ws" ? "WebSocket" : "SSE")} open={rt.open} onClear={rtClear} />
      <div className="min-h-0 flex-1">
        {rt.messages.length === 0 ? (
          <EmptyState
            icon={<Radio size={40} strokeWidth={1.3} />}
            title={requestMode === "ws" ? "WebSocket console" : "SSE stream"}
            subtitle={
              requestMode === "ws"
                ? "Enter a ws:// or wss:// URL and hit Connect. Messages stream here; send frames from the box below."
                : "Enter an http(s):// URL that returns text/event-stream and hit Connect. Events stream here as they arrive."
            }
          />
        ) : (
          <MessageLog messages={rt.messages} />
        )}
      </div>
      {requestMode === "ws" && <SendBox disabled={rt.status !== "open"} />}
    </div>
  );
}

const STATUS_STYLE: Record<RtStatus, { label: string; cls: string; dot: string }> = {
  idle: { label: "Idle", cls: "text-slate-400", dot: "bg-slate-400" },
  connecting: { label: "Connecting", cls: "text-amber-500", dot: "bg-amber-500 animate-pulse" },
  open: { label: "Connected", cls: "text-emerald-500", dot: "bg-emerald-500" },
  closed: { label: "Closed", cls: "text-slate-400", dot: "bg-slate-400" },
  error: { label: "Error", cls: "text-rose-500", dot: "bg-rose-500" },
};

function StatusHeader({
  status,
  protocol,
  open,
  onClear,
}: {
  status: RtStatus;
  protocol: string;
  open: ReturnType<typeof useStore.getState>["rt"]["open"];
  onClear: () => void;
}) {
  const st = STATUS_STYLE[status];
  const t = open?.timings;
  const tls = open?.network.tls;
  const remote = open?.network.connection.remoteAddr;
  return (
    <div className="border-b border-slate-200 px-4 py-2.5 dark:border-white/[0.08]">
      <div className="flex items-center gap-3">
        <span className={cx("flex items-center gap-1.5 text-sm font-semibold", st.cls)}>
          <span className={cx("h-2 w-2 rounded-full", st.dot)} />
          {st.label}
        </span>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{protocol}</span>
        {open?.status != null && (
          <span className="font-mono text-xs text-slate-400">HTTP {open.status}</span>
        )}
        <button
          onClick={onClear}
          title="Clear messages"
          className="no-drag ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-200"
        >
          <Trash2 size={12} /> Clear
        </button>
      </div>
      {t && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
          <HandshakeStat label="DNS" value={formatMs(t.dnsMs)} />
          <HandshakeStat label="TCP" value={formatMs(t.tcpMs)} />
          {tls && <HandshakeStat label="TLS" value={formatMs(t.tlsMs)} />}
          <HandshakeStat label="handshake" value={formatMs(t.totalMs)} />
          {tls?.version && <HandshakeStat label="" value={tls.version} />}
          {remote && <HandshakeStat label="" value={remote} />}
        </div>
      )}
    </div>
  );
}

function HandshakeStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono">
      {label && <span className="text-slate-400 dark:text-slate-500">{label} </span>}
      <span className="text-slate-500 dark:text-slate-300">{value}</span>
    </span>
  );
}

function MessageLog({ messages }: { messages: RtMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div onScroll={onScroll} className="h-full overflow-auto px-2 py-1.5">
      {messages.map((m) => (
        <MessageRow key={m.id} msg={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

const DIR_META = {
  sent: { icon: ArrowUp, cls: "text-indigo-500", bg: "" },
  received: { icon: ArrowDown, cls: "text-emerald-500", bg: "" },
  info: { icon: Info, cls: "text-slate-400", bg: "" },
  error: { icon: TriangleAlert, cls: "text-rose-500", bg: "" },
  system: { icon: Info, cls: "text-slate-400", bg: "" },
} as const;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function MessageRow({ msg }: { msg: RtMessage }) {
  const meta = DIR_META[msg.direction];
  const Icon = meta.icon;
  const muted = msg.direction === "system" || msg.direction === "info";
  return (
    <div className="flex gap-2 rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
      <Icon size={13} className={cx("mt-0.5 shrink-0", meta.cls)} />
      <div className="min-w-0 flex-1">
        <pre
          className={cx(
            "whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed",
            muted ? "text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200",
          )}
        >
          {msg.text}
        </pre>
      </div>
      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-slate-300 dark:text-slate-600">
        {msg.bytes != null && <span className="mr-2">{formatBytes(msg.bytes)}</span>}
        {fmtTime(msg.at)}
      </span>
    </div>
  );
}

function SendBox({ disabled }: { disabled: boolean }) {
  const rtSend = useStore((s) => s.rtSend);
  const [text, setText] = useState("");

  const doSend = () => {
    if (disabled || !text) return;
    rtSend(text);
    setText("");
  };

  return (
    <div className="flex items-end gap-2 border-t border-slate-200 p-2 dark:border-white/[0.08]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            doSend();
          }
        }}
        disabled={disabled}
        placeholder={disabled ? "Connect to send messages…" : 'Message to send (Enter to send, Shift+Enter for newline)'}
        rows={2}
        spellCheck={false}
        className="no-drag min-h-0 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      <button
        onClick={doSend}
        disabled={disabled || !text}
        className="no-drag inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-40"
      >
        <Send size={14} /> Send
      </button>
    </div>
  );
}
