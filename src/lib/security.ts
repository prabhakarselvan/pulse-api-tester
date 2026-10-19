// Derives a security "report card" for a response from data Pulse already
// captures: TLS parameters, the certificate chain, response headers and cookies.

import type { HttpResponse, KeyValue } from "./types";

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SecurityReport {
  grade: string;
  score: number;
  checks: Check[];
}

function header(headers: KeyValue[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.key.toLowerCase() === lower)?.value;
}

function parseCookies(headers: KeyValue[]) {
  return headers
    .filter((h) => h.key.toLowerCase() === "set-cookie")
    .map((h) => {
      const attrs = h.value.toLowerCase();
      const name = h.value.split("=")[0].trim();
      return {
        name,
        secure: attrs.includes("secure"),
        httpOnly: attrs.includes("httponly"),
        sameSite: /samesite=/.test(attrs),
      };
    });
}

export function analyzeSecurity(res: HttpResponse): SecurityReport {
  const checks: Check[] = [];
  const h = res.headers;
  const tls = res.network.tls;
  const isHttps = res.network.scheme === "https";

  // --- Transport ---
  if (isHttps) {
    checks.push({
      id: "transport",
      label: "Encrypted transport",
      status: "pass",
      detail: "The connection uses HTTPS (TLS).",
    });
  } else {
    checks.push({
      id: "transport",
      label: "Encrypted transport",
      status: "fail",
      detail: "Plain HTTP — traffic is sent unencrypted and can be read or modified in transit.",
    });
  }

  if (tls && tls.version) {
    const v = tls.version;
    const status: CheckStatus = v.includes("1.3") ? "pass" : v.includes("1.2") ? "warn" : "fail";
    checks.push({
      id: "tls-version",
      label: `TLS version — ${v}`,
      status,
      detail:
        status === "pass"
          ? "TLS 1.3 is the current, strongest protocol version."
          : status === "warn"
            ? "TLS 1.2 is acceptable but TLS 1.3 is preferred."
            : "This TLS version is outdated and considered insecure.",
    });
  }

  if (tls && tls.cipherSuite) {
    const c = tls.cipherSuite.toUpperCase();
    const aead = c.includes("GCM") || c.includes("CHACHA") || c.includes("POLY1305");
    checks.push({
      id: "cipher",
      label: `Cipher — ${tls.cipherSuite}`,
      status: aead ? "pass" : "warn",
      detail: aead
        ? "An authenticated (AEAD) cipher suite is in use."
        : "This cipher is not a modern AEAD suite; prefer GCM or ChaCha20-Poly1305.",
    });
  }

  // --- Certificate expiry (leaf cert) ---
  const leaf = tls?.certificates?.[0];
  if (leaf?.notAfterTs != null) {
    const days = Math.floor((leaf.notAfterTs * 1000 - Date.now()) / 86_400_000);
    let status: CheckStatus = "pass";
    let detail = `Certificate valid for ${days} more day${days === 1 ? "" : "s"}.`;
    if (days < 0) {
      status = "fail";
      detail = `Certificate EXPIRED ${-days} day${days === -1 ? "" : "s"} ago.`;
    } else if (days < 14) {
      status = "warn";
      detail = `Certificate expires soon — in ${days} day${days === 1 ? "" : "s"}.`;
    }
    checks.push({ id: "cert-expiry", label: "Certificate validity", status, detail });
  }

  // --- HTTP version ---
  const httpVer = res.network.connection.httpVersion;
  if (httpVer) {
    const modern = httpVer.includes("2") || httpVer.includes("3");
    checks.push({
      id: "http-version",
      label: `Protocol — ${httpVer}`,
      status: modern ? "pass" : "info",
      detail: modern
        ? "Multiplexed, modern HTTP."
        : "HTTP/1.1 — functional, but HTTP/2+ is faster for many requests.",
    });
  }

  // --- Security headers (only meaningful over HTTPS) ---
  const hsts = header(h, "strict-transport-security");
  checks.push({
    id: "hsts",
    label: "HSTS (Strict-Transport-Security)",
    status: hsts ? "pass" : isHttps ? "warn" : "info",
    detail: hsts
      ? `Present: ${hsts}`
      : "Missing — browsers won't be forced to use HTTPS on future visits.",
  });

  const csp = header(h, "content-security-policy");
  checks.push({
    id: "csp",
    label: "Content-Security-Policy",
    status: csp ? "pass" : "warn",
    detail: csp ? "Present — mitigates XSS and injection." : "Missing — no CSP protection against injected content.",
  });

  const xcto = header(h, "x-content-type-options");
  checks.push({
    id: "xcto",
    label: "X-Content-Type-Options",
    status: xcto?.toLowerCase().includes("nosniff") ? "pass" : "warn",
    detail: xcto
      ? `Set to "${xcto}".`
      : "Missing `nosniff` — the browser may MIME-sniff responses.",
  });

  const xfo = header(h, "x-frame-options");
  const frameAncestors = csp?.toLowerCase().includes("frame-ancestors");
  checks.push({
    id: "clickjacking",
    label: "Clickjacking protection",
    status: xfo || frameAncestors ? "pass" : "warn",
    detail:
      xfo || frameAncestors
        ? "Framing is restricted (X-Frame-Options or CSP frame-ancestors)."
        : "No X-Frame-Options / frame-ancestors — the page may be embeddable in a hostile frame.",
  });

  const referrer = header(h, "referrer-policy");
  checks.push({
    id: "referrer",
    label: "Referrer-Policy",
    status: referrer ? "pass" : "info",
    detail: referrer ? `Set to "${referrer}".` : "Not set — default referrer behavior applies.",
  });

  const server = header(h, "server");
  const powered = header(h, "x-powered-by");
  if (server || powered) {
    checks.push({
      id: "disclosure",
      label: "Server version disclosure",
      status: "info",
      detail: `Reveals: ${[server, powered].filter(Boolean).join(", ")}. Consider hiding versions.`,
    });
  }

  // --- Cookies ---
  for (const c of parseCookies(h)) {
    const problems: string[] = [];
    if (!c.secure) problems.push("Secure");
    if (!c.httpOnly) problems.push("HttpOnly");
    if (!c.sameSite) problems.push("SameSite");
    checks.push({
      id: `cookie-${c.name}`,
      label: `Cookie "${c.name}"`,
      status: problems.length === 0 ? "pass" : "warn",
      detail:
        problems.length === 0
          ? "Has Secure, HttpOnly and SameSite."
          : `Missing flag${problems.length > 1 ? "s" : ""}: ${problems.join(", ")}.`,
    });
  }

  // --- Score / grade ---
  let score = 100;
  for (const c of checks) {
    if (c.status === "fail") score -= c.id === "transport" || c.id === "cert-expiry" ? 35 : 20;
    else if (c.status === "warn") score -= 6;
  }
  score = Math.max(0, Math.min(100, score));
  const grade =
    score >= 93 ? "A" : score >= 85 ? "A-" : score >= 78 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return { grade, score, checks };
}
