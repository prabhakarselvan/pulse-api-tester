// Sandboxed pre-request / post-response scripting.
//
// User scripts run inside a Web Worker (no DOM, no Tauri, no network) with a
// `pm`-style API, a chai-like `expect`, and a captured `console`. The worker is
// terminated after a timeout so a runaway script can't hang the app.

import type { HttpRequest, HttpResponse } from "./types";

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface LogLine {
  level: string;
  text: string;
}

export interface ScriptResult {
  request: HttpRequest;
  vars: Record<string, string>;
  tests: TestResult[];
  logs: LogLine[];
  error: string | null;
}


export function runScript(
  phase: "pre" | "post",
  code: string,
  request: HttpRequest,
  response: HttpResponse | null,
  vars: Record<string, string>,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const fallback = (error: string): ScriptResult => ({
      request,
      vars,
      tests: [],
      logs: [],
      error,
    });

    let worker: Worker;
    try {
      // Bundled same-origin worker (NOT a blob:) — a blob worker created from the
      // tauri:// scheme has an opaque origin that WebKit blocks under CSP.
      worker = new Worker(new URL("./scriptWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch (e) {
      resolve(fallback(`Could not start script sandbox: ${String(e)}`));
      return;
    }

    const cleanup = () => {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(fallback("Script timed out after 5s."));
    }, 5000);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      cleanup();
      const d = e.data || {};
      resolve({
        request: d.request ?? request,
        vars: d.vars ?? vars,
        tests: Array.isArray(d.tests) ? d.tests : [],
        logs: Array.isArray(d.logs) ? d.logs : [],
        error: d.error ?? null,
      });
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timer);
      cleanup();
      resolve(fallback(e.message || "Script error."));
    };

    worker.postMessage({ phase, code, request, response, vars });
  });
}
