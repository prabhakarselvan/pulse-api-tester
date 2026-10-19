# Pulse — a fast, native API tester for macOS

Pulse is a Postman-style API client built in **Rust + Tauri 2 + React**, with one thing
Postman hides: **deep network introspection**. Every request shows a full timing waterfall
(DNS → TCP → TLS → TTFB → download), the DNS resolver + resolved IPs, the TLS version/cipher
and full certificate chain, the negotiated HTTP version, and the redirect chain — each with an
inline "?" that explains the concept.

## Features

- **Tabbed workspace** — open many requests at once in tabs; each tab keeps its own request,
  response, and test results. Switch, add (＋), and close tabs; open tabs are restored on restart.
- **Request builder** — all methods, query params, headers, and body types (JSON, text,
  form-urlencoded, multipart, binary, GraphQL), with Bearer / Basic / API-Key auth.
- **Response viewer** — syntax-highlighted Pretty / Raw / Preview (renders HTML & images),
  headers, and parsed cookies.
- **Network panel (the hero)** — per-phase timing waterfall, DNS resolver detail (nameservers,
  all IPs, TTL), TLS version + cipher + ALPN + full certificate chain (subject, issuer,
  validity, SANs, SHA-256 fingerprint), HTTP version, sizes, and redirect chain.
- **Collections & history** — saved requests and request history persisted locally in SQLite.
- **Collections (folders) + Postman import** — organize requests into nested-folder collections;
  **import your Postman collections** (v2.0 / v2.1) via a native file picker (multi-select) or by
  pasting JSON. Folders, requests, all body modes, auth, and URL query params are mapped, and
  Postman collection/environment variables become Pulse environments (`{{var}}` works as-is).
- **Security report card** — each response is graded (A–F) on TLS version/cipher, certificate
  expiry, security headers (HSTS, CSP, X-Content-Type-Options, clickjacking, …) and cookie flags,
  each with a plain-English explanation.
- **Flow visualizer** — an animated view of the request's journey (You → DNS → TCP → TLS →
  request → **server wait** → download): a travelling-packet wire plus per-phase data beams, with
  waits emphasized and a plain-English note on where the time went. Replayable.
- **Latency profiler** — fire the request ×N and see the distribution (p50 / p95 / min / max),
  a per-run sparkline, and the average per-phase breakdown.
- **Import cURL & "Copy as" code** — paste a cURL command to build a request; export the current
  request as cURL, JavaScript `fetch`, Python `requests`, or Rust `reqwest`.
- **Environments & `{{variables}}`** — define reusable variables in named environments and
  reference them as `{{var}}` in URL/headers/body/auth; switch the active environment from the
  toolbar. Substitution happens at send time (history keeps the template, not resolved secrets).
- **Beginner-friendly** — sample requests, educational tooltips, ⌘↵ to send, light/dark theme.

Networking is a hand-rolled instrumented client (`hyper` + `rustls` + `hickory-resolver`) so
every phase is measured on the *real* request — not a separate probe.

## Prerequisites

- Rust (stable) — `rustc`/`cargo` on `PATH`
- Node.js 18+ and npm
- Xcode Command Line Tools

## Develop & run

```bash
npm install
npm run tauri dev      # launches the app (Vite dev server + Rust backend)
```

## Build a distributable

```bash
npm run tauri build    # produces a .app and .dmg under src-tauri/target/release/bundle
```

## Project layout

```
src/                     React frontend (TypeScript + Tailwind)
  components/            RequestPanel, ResponsePanel, NetworkPanel, Sidebar, …
  lib/                   types, invoke wrappers, formatting, samples
  store.ts               Zustand state
src-tauri/src/
  model.rs               Shared serde contract (mirrors src/lib/types.ts)
  net/                   Instrumented client: dns.rs, tls.rs, client.rs
  store.rs               SQLite persistence
  commands.rs            Tauri commands (the invoke surface)
examples/probe.rs        Headless end-to-end probe of the networking core
```

## Note on corporate proxies (Zscaler, etc.)

This project was built behind a Zscaler proxy that blocks a few specific crate downloads on
crates.io (e.g. `untrusted`). Two accommodations are baked in:

- **`[patch.crates-io]`** in `src-tauri/Cargo.toml` sources the `untrusted` crate from its
  official git repo (github.com is reachable) instead of the blocked CDN path.
- When fetching, disable HTTP multiplexing and retry, which gets past intermittent proxy blocks:

  ```bash
  CARGO_HTTP_MULTIPLEXING=false CARGO_NET_RETRY=10 cargo fetch --manifest-path src-tauri/Cargo.toml
  ```

Pulse trusts your system/corporate root CAs automatically (via `rustls-native-certs`), so it
works transparently through a TLS-inspecting proxy — the certificate panel will show the
proxy's intercepting certificate when one is present.
