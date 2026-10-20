// Small display helpers shared across the UI.

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ${units[i]}`;
}

export function formatMs(ms: number): string {
  if (!isFinite(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export type Tone = "success" | "redirect" | "client" | "server" | "info";

export function statusTone(status: number): Tone {
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  if (status >= 300) return "redirect";
  if (status >= 200) return "success";
  return "info";
}

/** Tailwind text/bg classes per HTTP method, for the method pill. */
export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-500";
    case "POST":
      return "text-amber-500";
    case "PUT":
      return "text-blue-400";
    case "PATCH":
      return "text-violet-400";
    case "DELETE":
      return "text-rose-500";
    case "HEAD":
    case "OPTIONS":
      return "text-slate-400";
    default:
      return "text-slate-400";
  }
}

export function statusColor(status: number): string {
  switch (statusTone(status)) {
    case "success":
      return "text-emerald-500";
    case "redirect":
      return "text-blue-400";
    case "client":
      return "text-amber-500";
    case "server":
      return "text-rose-500";
    default:
      return "text-slate-400";
  }
}

export type BodyLang = "json" | "html" | "xml" | "javascript" | "text";

export function detectLang(contentType: string | null | undefined): BodyLang {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("javascript") || ct.includes("ecmascript")) return "javascript";
  return "text";
}

/** Pretty-print JSON when possible; otherwise return the original text. */
export function maybePretty(text: string, lang: BodyLang): string {
  if (lang === "json") {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  if (lang === "xml") return prettyXml(text);
  return text;
}

/**
 * Lightweight XML pretty-printer (no parser): puts each tag on its own line and
 * indents by nesting depth. Best-effort — returns the input unchanged on any
 * surprise. Good enough for SOAP envelopes and typical XML payloads.
 */
export function prettyXml(xml: string): string {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<")) return xml;
  // Re-indenting would split tag-like sequences inside CDATA/comments — leave
  // those documents untouched rather than risk corrupting their content.
  if (trimmed.includes("<![CDATA[") || trimmed.includes("<!--")) return xml;
  try {
    const PAD = "  ";
    // Break between adjacent tags so each ends up on its own line.
    const split = trimmed.replace(/>\s*</g, ">\n<");
    let depth = 0;
    const out: string[] = [];
    for (let line of split.split("\n")) {
      line = line.trim();
      if (!line) continue;
      const isClosing = /^<\//.test(line);
      const isSelfContained =
        /^<\?/.test(line) || // declaration
        /^<!--/.test(line) || // comment
        /\/>\s*$/.test(line) || // self-closing
        /^<[^>]+>[^<]*<\/[^>]+>\s*$/.test(line); // <a>text</a> on one line
      if (isClosing) depth = Math.max(depth - 1, 0);
      out.push(PAD.repeat(depth) + line);
      if (!isClosing && !isSelfContained && /^<[^!?]/.test(line)) depth += 1;
    }
    return out.join("\n");
  } catch {
    return xml;
  }
}

/**
 * Pretty-print JSON, tolerating `{{variables}}` used as bare values (common in
 * API testing). Returns `ok: false` when the text can't be parsed as JSON.
 */
export function beautifyJson(raw: string): { text: string; ok: boolean } {
  if (!raw.trim()) return { text: raw, ok: false };

  // Fast path: already-valid JSON (includes {{vars}} inside quoted strings).
  try {
    return { text: JSON.stringify(JSON.parse(raw), null, 2), ok: true };
  } catch {
    /* fall through to variable-aware attempt */
  }

  // Mask {{var}} tokens with placeholder strings so bare-value variables parse.
  const vars: string[] = [];
  const masked = raw.replace(/\{\{[^{}]*\}\}/g, (m) => {
    const token = `"__PULSE_VAR_${vars.length}__"`;
    vars.push(m);
    return token;
  });
  try {
    let pretty = JSON.stringify(JSON.parse(masked), null, 2);
    pretty = pretty.replace(/"__PULSE_VAR_(\d+)__"/g, (_m, i) => vars[Number(i)] ?? "");
    return { text: pretty, ok: true };
  } catch {
    return { text: raw, ok: false };
  }
}

export function timeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function isImageType(contentType: string | null | undefined): boolean {
  return (contentType || "").toLowerCase().startsWith("image/");
}
