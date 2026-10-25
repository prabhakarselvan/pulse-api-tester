// Lightweight, synchronous OS detection for cosmetic/layout decisions.
//
// We sniff the webview User-Agent rather than pull in @tauri-apps/plugin-os so
// this stays dependency-free and usable at module-load time (no async). It is
// only used for presentation (e.g. where the native window controls sit), never
// for behavior, so UA sniffing is perfectly adequate here.

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isMac = /Macintosh|Mac OS X/.test(ua);
export const isWindows = /Windows/.test(ua);
export const isLinux = /Linux/.test(ua) && !/Android/.test(ua);

/**
 * On macOS the window uses `titleBarStyle: "Overlay"`, so the traffic-light
 * buttons float over the top-left of our header and we must reserve space for
 * them. On Windows/Linux the window uses native decorations (controls live in
 * the OS title bar, top-right), so no left inset is needed.
 */
export const titleBarLeftInset = isMac ? "pl-[92px]" : "pl-3";

/** A platform-appropriate example file path (for input placeholders). */
export function sampleFilePath(name: string): string {
  if (isWindows) return `C:\\Users\\you\\${name.replace(/\//g, "\\")}`;
  return `/Users/you/${name}`;
}
