# Building Pulse

Pulse is a Tauri 2 app and runs on **macOS, Windows, and Linux** from the same
codebase. Tauri cannot cross-compile the platform webview, so each OS must be
built on that OS (or via the CI matrix below).

## Prerequisites (all platforms)

- **Node.js** 18+ and npm
- **Rust** (stable) — https://rustup.rs

Then, from the repo root:

```bash
npm install
npm run tauri dev     # run locally with hot reload
npm run tauri build   # produce a release bundle for the current OS
```

## Platform-specific setup

### macOS
Nothing extra — Xcode Command Line Tools (`xcode-select --install`) provide the
C toolchain. Produces a `.app` and `.dmg` under
`src-tauri/target/release/bundle/`.

### Windows
- **Microsoft C++ Build Tools** (MSVC) — needed by `ring` and the bundled
  SQLite. Install "Desktop development with C++" from the Visual Studio Build
  Tools.
- **WebView2 Runtime** — preinstalled on Windows 11 and recent Windows 10; the
  installer bootstraps it otherwise.

Produces an `.msi` and an NSIS `-setup.exe`.

### Linux
Install the WebKitGTK / GTK stack (Debian/Ubuntu names shown):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf build-essential curl wget file libssl-dev
```

Produces an `.AppImage`, `.deb`, and (where supported) `.rpm`.

## Continuous Integration

`.github/workflows/build.yml` builds all three platforms on GitHub-hosted
runners:

- **Manual run** (`workflow_dispatch`) → bundles uploaded as workflow artifacts.
- **Tag push** (`v*`, e.g. `git tag v0.1.0 && git push --tags`) → a **draft
  GitHub Release** with every platform's installers attached.

## Notes

- **`[patch.crates-io] untrusted = { git = … }`** in `src-tauri/Cargo.toml` is a
  workaround for a corporate proxy that blocks the `untrusted` crate download. It
  sources the crate from its official git repo instead, which works anywhere
  github.com is reachable (including CI). It is harmless on networks without the
  proxy; leave it in place.
- Platform-specific **UI** differences (the title-bar inset, example file-path
  placeholders) are handled at runtime in `src/lib/platform.ts`, so a single
  build adapts to the OS it runs on. macOS keeps its overlaid traffic-light
  layout; Windows/Linux use their native window decorations.
