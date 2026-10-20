import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { HttpResponse } from "../lib/types";
import { IconButton } from "./ui";

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

export function WirePanel({ res }: { res: HttpResponse }) {
  const responseText =
    res.rawResponseHead +
    "\r\n" +
    (res.body || (res.bodyBase64 ? `<${res.bodySizeBytes} bytes of binary data>` : ""));

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-3">
      <RawBlock title="Request" text={res.rawRequest} />
      <RawBlock title="Response" text={responseText} />
    </div>
  );
}
