# Security

Pulse is a local, offline‑first desktop app. Your requests, collections, and
environments never leave your machine except as the HTTP requests you explicitly
send. This document explains the security model and its current limitations so you
can use it safely.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
private **[Security Advisories](https://github.com/prabhakarselvan/pulse-api-tester/security/advisories/new)**
for this repository. You'll get an acknowledgement and a fix timeline.

## What's protected

- **The script sandbox has no network.** Pre/post‑request scripts run in a Web Worker
  with `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and `importScripts`
  removed, and a strict Content‑Security‑Policy (`connect-src 'self'`) on top. A script
  cannot phone home or load remote code.
- **No native reach from scripts.** The sandbox has no access to the filesystem,
  the Tauri command bridge, or the DOM, and is terminated after a 5‑second timeout.
- **Credentials aren't leaked across origins.** On a cross‑origin redirect, Pulse strips
  `Authorization`, `Cookie`, and any non‑safelisted request headers.
- **Imports can't read your files.** Imported collections never carry local file
  *paths*; you must re‑attach any file to upload via the picker.
- **TLS is verified by default** (per‑request `Verify TLS` toggle), and decompression
  is bounded to prevent decompression‑bomb crashes.

## Known limitations

- **Secrets are stored in cleartext on disk.** Auth tokens, passwords, API keys, client
  certificates, cookies, and environment variables are kept in a local SQLite database
  (unencrypted), the same as most desktop API clients. Anyone with access to your user
  account / disk can read them. OS‑keychain storage is planned.
- **A script can still rewrite the request it runs on.** Scripts are powerful by design
  (they can change the URL, headers, and body of the request Pulse then sends). **Only
  import and run collections you trust** — a malicious collection's script could
  redirect a request or embed `{{secret}}` values into an attacker‑controlled URL.
- **Builds are not yet code‑signed or notarized.** Verify your download comes from the
  official [releases page](https://github.com/prabhakarselvan/pulse-api-tester/releases).
- **It's an API client — it will reach any URL you give it**, including internal or
  cloud‑metadata addresses. That's intended; just be mindful when running shared collections.

## Scope

Pulse's threat model assumes a trusted local machine. Attacks that require already
having code execution or disk access on your machine are out of scope. The vectors we
actively defend against are **malicious server responses** and **untrusted imported
collections**.
