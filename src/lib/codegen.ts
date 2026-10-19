// Generate request snippets ("Copy as …") and parse a pasted cURL command.

import type { HttpRequest, KeyValue } from "./types";
import { defaultRequest } from "./samples";

// --- shared helpers --------------------------------------------------------

export function fullUrl(req: HttpRequest): string {
  const raw = req.url.trim();
  const base = raw.includes("://") ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return raw;
  }
  for (const p of req.queryParams) {
    if (p.enabled && p.key) url.searchParams.append(p.key, p.value);
  }
  if (req.auth.kind === "apikey" && req.auth.apiKeyIn === "query" && req.auth.apiKeyName) {
    url.searchParams.append(req.auth.apiKeyName, req.auth.apiKeyValue);
  }
  return url.toString();
}

/** Effective header list including auth + a default content-type. */
export function effectiveHeaders(req: HttpRequest): KeyValue[] {
  const out: KeyValue[] = req.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => ({ enabled: true, key: h.key, value: h.value }));

  const hasCt = out.some((h) => h.key.toLowerCase() === "content-type");
  const ct = defaultContentType(req);
  if (ct && !hasCt) out.push({ enabled: true, key: "Content-Type", value: ct });

  const a = req.auth;
  if (a.kind === "bearer" && a.token) out.push({ enabled: true, key: "Authorization", value: `Bearer ${a.token}` });
  if (a.kind === "basic") {
    const token = btoa(`${a.username}:${a.password}`);
    out.push({ enabled: true, key: "Authorization", value: `Basic ${token}` });
  }
  if (a.kind === "apikey" && a.apiKeyIn === "header" && a.apiKeyName) {
    out.push({ enabled: true, key: a.apiKeyName, value: a.apiKeyValue });
  }
  return out;
}

function defaultContentType(req: HttpRequest): string | null {
  switch (req.body.mode) {
    case "json":
    case "graphql":
      return "application/json";
    case "text":
      return "text/plain";
    case "form":
      return "application/x-www-form-urlencoded";
    default:
      return null;
  }
}

/** The body as a string for codegen (multipart/binary handled specially). */
export function bodyText(req: HttpRequest): string {
  const b = req.body;
  switch (b.mode) {
    case "json":
    case "text":
      return b.raw;
    case "graphql":
      return JSON.stringify({
        query: b.raw,
        variables: safeJson(b.graphqlVariables),
      });
    case "form":
      return b.form
        .filter((f) => f.enabled && f.key)
        .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
        .join("&");
    default:
      return "";
  }
}

function safeJson(s: string): unknown {
  try {
    return s.trim() ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// --- generators ------------------------------------------------------------

export function toCurl(req: HttpRequest): string {
  const lines = [`curl -X ${req.method} ${sq(fullUrl(req))}`];
  if (req.followRedirects) lines[0] = `curl -L -X ${req.method} ${sq(fullUrl(req))}`;
  if (!req.verifyTls) lines[0] += " -k";
  for (const h of effectiveHeaders(req)) lines.push(`  -H ${sq(`${h.key}: ${h.value}`)}`);
  if (req.body.mode === "multipart") {
    for (const f of req.body.multipart.filter((f) => f.enabled && f.key)) {
      lines.push(f.kind === "file" ? `  -F ${sq(`${f.key}=@${f.value}`)}` : `  -F ${sq(`${f.key}=${f.value}`)}`);
    }
  } else if (req.body.mode === "binary" && req.body.binaryPath) {
    lines.push(`  --data-binary ${sq(`@${req.body.binaryPath}`)}`);
  } else {
    const body = bodyText(req);
    if (body) lines.push(`  --data ${sq(body)}`);
  }
  return lines.join(" \\\n");
}

export function toFetch(req: HttpRequest): string {
  const headers = Object.fromEntries(effectiveHeaders(req).map((h) => [h.key, h.value]));
  const opts: Record<string, unknown> = { method: req.method };
  if (Object.keys(headers).length) opts.headers = headers;
  const body = ["multipart", "binary"].includes(req.body.mode) ? null : bodyText(req);
  if (body) opts.body = body;
  return `const res = await fetch(${JSON.stringify(fullUrl(req))}, ${JSON.stringify(
    opts,
    null,
    2,
  )});\nconst data = await res.text();\nconsole.log(res.status, data);`;
}

export function toPython(req: HttpRequest): string {
  const headers = Object.fromEntries(effectiveHeaders(req).map((h) => [h.key, h.value]));
  const lines = ["import requests", ""];
  lines.push(`url = ${JSON.stringify(fullUrl(req))}`);
  if (Object.keys(headers).length) lines.push(`headers = ${pyDict(headers)}`);
  const body = ["multipart", "binary"].includes(req.body.mode) ? "" : bodyText(req);
  if (body) lines.push(`data = ${JSON.stringify(body)}`);
  const args = ["url"];
  if (Object.keys(headers).length) args.push("headers=headers");
  if (body) args.push("data=data");
  lines.push("");
  lines.push(`res = requests.${req.method.toLowerCase()}(${args.join(", ")})`);
  lines.push("print(res.status_code, res.text)");
  return lines.join("\n");
}

export function toRust(req: HttpRequest): string {
  const lines = [
    "// requires: reqwest = { version = \"0.12\", features = [\"json\"] }, tokio",
    "let client = reqwest::Client::new();",
    `let res = client`,
    `    .request(reqwest::Method::${req.method.toUpperCase()}, ${JSON.stringify(fullUrl(req))})`,
  ];
  for (const h of effectiveHeaders(req)) lines.push(`    .header(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`);
  const body = ["multipart", "binary"].includes(req.body.mode) ? "" : bodyText(req);
  if (body) lines.push(`    .body(${JSON.stringify(body)})`);
  lines.push("    .send()");
  lines.push("    .await?;");
  lines.push("println!(\"{} {}\", res.status(), res.text().await?);");
  return lines.join("\n");
}

export const GENERATORS: { id: string; label: string; gen: (r: HttpRequest) => string }[] = [
  { id: "curl", label: "cURL", gen: toCurl },
  { id: "fetch", label: "JavaScript (fetch)", gen: toFetch },
  { id: "python", label: "Python (requests)", gen: toPython },
  { id: "rust", label: "Rust (reqwest)", gen: toRust },
];

function pyDict(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${entries.join(",\n")}\n}`;
}

// --- cURL parser -----------------------------------------------------------

/** Tokenize a shell-ish command honoring quotes and backslash-newline. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  const s = input.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else if (ch === "\\") {
      if (i + 1 < s.length) cur += s[++i];
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/** Parse a `curl …` command into an HttpRequest. Returns null if not curl. */
export function parseCurl(input: string): HttpRequest | null {
  const text = input.trim();
  if (!/^curl\b/.test(text)) return null;
  const tokens = tokenize(text).slice(1);

  const req = defaultRequest();
  const headers: KeyValue[] = [];
  let method = "";
  let url = "";
  let bodyData = "";
  const multipart: { key: string; kind: "text" | "file"; value: string; enabled: boolean }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i] ?? "";
    if (t === "-X" || t === "--request") method = next().toUpperCase();
    else if (t === "-H" || t === "--header") {
      const raw = next();
      const idx = raw.indexOf(":");
      if (idx > 0) headers.push({ enabled: true, key: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() });
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-ascii" || t === "--data-binary") {
      bodyData += (bodyData ? "&" : "") + next();
    } else if (t === "-F" || t === "--form") {
      const raw = next();
      const eq = raw.indexOf("=");
      if (eq > 0) {
        const key = raw.slice(0, eq);
        const val = raw.slice(eq + 1);
        const isFile = val.startsWith("@");
        multipart.push({ enabled: true, key, kind: isFile ? "file" : "text", value: isFile ? val.slice(1) : val });
      }
    } else if (t === "-u" || t === "--user") {
      const [u, ...p] = next().split(":");
      req.auth = { ...req.auth, kind: "basic", username: u, password: p.join(":") };
    } else if (t === "-b" || t === "--cookie") {
      headers.push({ enabled: true, key: "Cookie", value: next() });
    } else if (t === "--url") url = next();
    else if (t === "-L" || t === "--location") req.followRedirects = true;
    else if (t === "-k" || t === "--insecure") req.verifyTls = false;
    else if (t === "--compressed" || t === "-s" || t === "-i" || t === "-v" || t === "-#" || t === "--silent") {
      /* ignore */
    } else if (!t.startsWith("-") && !url) url = t;
  }

  req.url = url;
  req.headers = headers;

  if (multipart.length) {
    req.body = { ...req.body, mode: "multipart", multipart };
    req.method = method || "POST";
  } else if (bodyData) {
    const ctHeader = headers.find((h) => h.key.toLowerCase() === "content-type")?.value?.toLowerCase() ?? "";
    const looksJson = ctHeader.includes("json") || /^\s*[[{]/.test(bodyData);
    req.body = { ...req.body, mode: looksJson ? "json" : "text", raw: bodyData };
    req.method = method || "POST";
  } else {
    req.method = method || "GET";
  }

  return req;
}
