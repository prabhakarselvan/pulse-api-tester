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
 * Validate and pretty-print XML (SOAP envelopes, XML payloads). Unlike the
 * best-effort {@link prettyXml}, this parses with the webview's DOMParser so
 * malformed XML is reported honestly (`ok: false`, original text untouched),
 * then re-serializes with namespace-, attribute-, CDATA-, and comment-aware
 * indentation. `{{variables}}` in text/attribute positions are preserved as-is
 * (they're ordinary XML character data). Mirrors {@link beautifyJson}.
 */
export function beautifyXml(raw: string): { text: string; ok: boolean } {
  const src = raw.trim();
  if (!src.startsWith("<")) return { text: raw, ok: false };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(src, "application/xml");
  } catch {
    return { text: raw, ok: false };
  }
  // DOMParser signals a failure by inserting a <parsererror> element rather than
  // throwing — same check parseWsdl() uses.
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) {
    return { text: raw, ok: false };
  }

  const PAD = "  ";
  const escapeText = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttr = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  const lines: string[] = [];
  // DOMParser drops the XML declaration from the tree — keep the original's.
  const decl = src.match(/^<\?xml\b[^>]*\?>/i);
  if (decl) lines.push(decl[0]);

  const openTag = (el: Element): string => {
    let s = "<" + el.nodeName;
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      s += ` ${a.name}="${escapeAttr(a.value)}"`;
    }
    return s;
  };

  const walk = (node: Node, depth: number) => {
    const pad = PAD.repeat(depth);
    switch (node.nodeType) {
      case Node.ELEMENT_NODE: {
        const el = node as Element;
        // Drop whitespace-only text nodes so nesting indents cleanly.
        const kids = Array.from(el.childNodes).filter(
          (n) => !(n.nodeType === Node.TEXT_NODE && !(n.nodeValue ?? "").trim()),
        );
        if (kids.length === 0) {
          lines.push(pad + openTag(el) + "/>");
          return;
        }
        // A lone text/CDATA child stays inline: <tag>value</tag>.
        if (
          kids.length === 1 &&
          (kids[0].nodeType === Node.TEXT_NODE ||
            kids[0].nodeType === Node.CDATA_SECTION_NODE)
        ) {
          const only = kids[0];
          const inner =
            only.nodeType === Node.CDATA_SECTION_NODE
              ? `<![CDATA[${only.nodeValue ?? ""}]]>`
              : escapeText((only.nodeValue ?? "").trim());
          lines.push(pad + openTag(el) + ">" + inner + "</" + el.nodeName + ">");
          return;
        }
        lines.push(pad + openTag(el) + ">");
        for (const k of kids) walk(k, depth + 1);
        lines.push(pad + "</" + el.nodeName + ">");
        return;
      }
      case Node.TEXT_NODE: {
        const t = (node.nodeValue ?? "").trim();
        if (t) lines.push(pad + escapeText(t));
        return;
      }
      case Node.CDATA_SECTION_NODE:
        lines.push(pad + `<![CDATA[${node.nodeValue ?? ""}]]>`);
        return;
      case Node.COMMENT_NODE:
        lines.push(pad + `<!--${node.nodeValue ?? ""}-->`);
        return;
      case Node.PROCESSING_INSTRUCTION_NODE: {
        const pi = node as ProcessingInstruction;
        lines.push(pad + `<?${pi.target} ${pi.data}?>`);
        return;
      }
    }
  };

  try {
    walk(doc.documentElement, 0);
    return { text: lines.join("\n"), ok: true };
  } catch {
    return { text: raw, ok: false };
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

  // Mask {{var}} tokens so bare-value variables parse. A token already INSIDE a
  // string must be masked WITHOUT quotes (bareword), while a bare-value token gets
  // quoted (so it's a valid JSON string). Masking everything as a quoted string —
  // the old behavior — produced `""__PULSE_VAR__""` for `"{{x}}"`, which is invalid
  // JSON, so Beautify silently no-op'd on mixed bodies like {"id":{{n}},"s":"{{v}}"}.
  const vars: { token: string; bare: boolean }[] = [];
  let masked = "";
  let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (ch === "\\") {
        masked += ch + (raw[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === '"') {
        inStr = false;
        masked += ch;
        continue;
      }
    } else if (ch === '"') {
      inStr = true;
      masked += ch;
      continue;
    }
    if (ch === "{" && raw[i + 1] === "{") {
      const end = raw.indexOf("}}", i + 2);
      if (end !== -1) {
        const token = raw.slice(i, end + 2);
        const n = vars.length;
        vars.push({ token, bare: !inStr });
        masked += inStr ? `__PULSE_VAR_${n}__` : `"__PULSE_VAR_${n}__"`;
        i = end + 1;
        continue;
      }
    }
    masked += ch;
  }
  try {
    let pretty = JSON.stringify(JSON.parse(masked), null, 2);
    // Unmask: bare tokens are a full JSON string "__PULSE_VAR_n__" (strip the
    // quotes); in-string tokens are a bareword inside their string (keep quotes).
    for (let n = vars.length - 1; n >= 0; n--) {
      const { token, bare } = vars[n];
      const placeholder = bare ? `"__PULSE_VAR_${n}__"` : `__PULSE_VAR_${n}__`;
      pretty = pretty.split(placeholder).join(token);
    }
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
