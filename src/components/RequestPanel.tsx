import { useEffect, useRef, useState } from "react";
import { Check, ClipboardPaste, Code2, FilePlus, Radio, Save, Send } from "lucide-react";
import { useStore, type BuilderTab } from "../store";
import type { Auth } from "../lib/types";
import { methodColor } from "../lib/format";
import { GENERATORS, parseCurl } from "../lib/codegen";
import { BodyEditor } from "./BodyEditor";
import { ScriptsTab } from "./ScriptsTab";
import {
  Button,
  KeyValueEditor,
  Panel,
  Segmented,
  Select,
  Spinner,
  TextInput,
  cx,
  type SegOption,
} from "./ui";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function RequestPanel() {
  const request = useStore((s) => s.request);
  const patch = useStore((s) => s.patch);
  const send = useStore((s) => s.send);
  const loading = useStore((s) => s.loading);
  const builderTab = useStore((s) => s.builderTab);
  const setBuilderTab = useStore((s) => s.setBuilderTab);
  const newRequest = useStore((s) => s.newRequest);
  const requestName = useStore((s) => s.requestName);
  const setRequestName = useStore((s) => s.setRequestName);
  const requestMode = useStore((s) => s.requestMode);
  const setRequestMode = useStore((s) => s.setRequestMode);
  const collectionSource = useStore((s) => s.collectionSource);
  const rtConnect = useStore((s) => s.rtConnect);
  const rtDisconnect = useStore((s) => s.rtDisconnect);
  const rtStatus = useStore((s) => s.rt.status);
  // Only treat the (single, global) realtime connection as this tab's when it owns it.
  const rtOwned = useStore((s) => s.rt.ownerTabId === s.activeTabId);
  const isHttp = requestMode === "http";
  const rtLive = rtOwned && (rtStatus === "open" || rtStatus === "connecting");

  const modeOptions: SegOption<typeof requestMode>[] = [
    { value: "http", label: "HTTP" },
    { value: "ws", label: "WebSocket" },
    { value: "sse", label: "SSE" },
  ];

  const primaryAction = () => {
    if (isHttp) return send();
    return rtLive ? rtDisconnect() : rtConnect();
  };

  const enabledParams = request.queryParams.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key).length;

  const tabs: SegOption<BuilderTab>[] = [
    { value: "params", label: "Params", badge: enabledParams || undefined },
    { value: "headers", label: "Headers", badge: enabledHeaders || undefined },
    {
      value: "auth",
      label: "Auth",
      badge: request.auth.kind !== "none" ? "•" : undefined,
    },
    {
      value: "body",
      label: "Body",
      badge: request.body.mode !== "none" ? "•" : undefined,
    },
    {
      value: "scripts",
      label: "Scripts",
      badge:
        request.preRequestScript.trim() || request.postResponseScript.trim() ? "•" : undefined,
    },
    {
      value: "network",
      label: "Network",
      badge:
        request.proxyUrl.trim() || request.clientCertPem.trim() ? "•" : undefined,
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* Request name (shown above the endpoint toolbar) */}
      <div className="flex items-center gap-2">
        <input
          value={requestName}
          onChange={(e) => setRequestName(e.target.value)}
          placeholder="Untitled request"
          spellCheck={false}
          className="no-drag min-w-0 flex-1 bg-transparent px-1 text-sm font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        {collectionSource && (
          <span
            className="shrink-0 truncate rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500"
            title={`Linked to ${collectionSource.collectionName} — Save updates this request in the collection`}
          >
            ↩ {collectionSource.collectionName}
          </span>
        )}
      </div>

      {/* Protocol mode */}
      <Segmented options={modeOptions} value={requestMode} onChange={setRequestMode} />

      {/* Method + URL + Send/Connect */}
      <div className="flex items-stretch gap-2">
        <div className="flex flex-1 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-white/10 dark:bg-white/[0.03]">
          {isHttp && (
            <select
              value={request.method}
              onChange={(e) => patch({ method: e.target.value })}
              className={cx(
                "no-drag cursor-pointer border-r border-slate-200 bg-transparent px-3 text-sm font-bold outline-none dark:border-white/10",
                methodColor(request.method),
              )}
            >
              {METHODS.map((m) => (
                <option key={m} value={m} className="text-slate-900">
                  {m}
                </option>
              ))}
            </select>
          )}
          {!isHttp && (
            <span className="flex items-center border-r border-slate-200 px-3 text-xs font-bold uppercase text-indigo-500 dark:border-white/10">
              {requestMode}
            </span>
          )}
          <input
            value={request.url}
            onChange={(e) => patch({ url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") primaryAction();
            }}
            placeholder={
              requestMode === "ws"
                ? "wss://echo.websocket.org"
                : requestMode === "sse"
                  ? "https://api.example.com/events"
                  : "https://api.example.com/endpoint"
            }
            className="no-drag min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            spellCheck={false}
          />
        </div>
        {isHttp ? (
          <Button variant="primary" onClick={() => send()} disabled={loading} className="px-5">
            {loading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <>
                <Send size={15} /> Send
              </>
            )}
          </Button>
        ) : (
          <Button
            variant={rtLive ? "subtle" : "primary"}
            onClick={() => primaryAction()}
            className="px-5"
          >
            {rtLive && rtStatus === "connecting" ? (
              <>
                <Spinner className="h-4 w-4" /> Connecting
              </>
            ) : rtLive ? (
              <>
                <Radio size={15} /> Disconnect
              </>
            ) : (
              <>
                <Radio size={15} /> Connect
              </>
            )}
          </Button>
        )}
        <Button variant="subtle" onClick={newRequest} title="New request">
          <FilePlus size={15} />
        </Button>
        <SaveControl />
        <ImportCurlControl />
        <CopyAsControl />
      </div>

      {/* Builder tabs + request options */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented options={tabs} value={builderTab} onChange={setBuilderTab} />
        <RequestOptions />
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {builderTab === "params" && (
          <KeyValueEditor
            items={request.queryParams}
            onChange={(queryParams) => patch({ queryParams })}
            keyPlaceholder="param"
            valuePlaceholder="value"
          />
        )}
        {builderTab === "headers" && (
          <KeyValueEditor
            items={request.headers}
            onChange={(headers) => patch({ headers })}
            keyPlaceholder="Header-Name"
            valuePlaceholder="value"
          />
        )}
        {builderTab === "auth" && <AuthEditor />}
        {builderTab === "body" && <BodyEditor />}
        {builderTab === "scripts" && <ScriptsTab />}
        {builderTab === "network" && <NetworkOptions />}
      </div>
    </div>
  );
}

function RequestOptions() {
  const request = useStore((s) => s.request);
  const patch = useStore((s) => s.patch);
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
      <label className="no-drag flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={request.followRedirects}
          onChange={(e) => patch({ followRedirects: e.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer accent-indigo-500"
        />
        Follow redirects
      </label>
      <label className="no-drag flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={request.verifyTls}
          onChange={(e) => patch({ verifyTls: e.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer accent-indigo-500"
        />
        Verify TLS
      </label>
      <label
        className="no-drag flex cursor-pointer items-center gap-1.5"
        title="Keep-alive: reuse the pooled connection to the same origin on the next send (skips DNS/TCP/TLS). Watch the Network tab — those phases drop to 0 ms on reuse."
      >
        <input
          type="checkbox"
          checked={request.reuseConnection}
          onChange={(e) => patch({ reuseConnection: e.target.checked })}
          className="h-3.5 w-3.5 cursor-pointer accent-indigo-500"
        />
        Keep-alive
      </label>
    </div>
  );
}

function NetworkOptions() {
  const request = useStore((s) => s.request);
  const patch = useStore((s) => s.patch);
  const textareaCls =
    "no-drag w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder:text-slate-500";

  return (
    <div className="max-w-2xl space-y-5">
      {/* Keep-alive */}
      <label className="no-drag flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={request.reuseConnection}
          onChange={(e) => patch({ reuseConnection: e.target.checked })}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-indigo-500"
        />
        <span className="text-xs">
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            Reuse connection (keep-alive)
          </span>
          <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
            Pool and reuse the TCP/TLS connection to the same origin across sends.
            On a reused connection DNS, TCP and TLS all read 0&nbsp;ms in the Network
            tab — a direct measure of the handshake you saved.
          </span>
        </span>
      </label>

      {/* HTTP proxy */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          HTTP proxy
        </div>
        <TextInput
          value={request.proxyUrl}
          onChange={(e) => patch({ proxyUrl: e.target.value })}
          placeholder="http://user:pass@proxy.host:8080"
          className="font-mono"
        />
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Tunnels every request through the proxy via HTTP <code>CONNECT</code>.
          Optional <code>user:pass@</code> adds Proxy-Authorization. (SOCKS is not
          supported.)
        </p>
      </div>

      {/* mTLS */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Client certificate (mutual TLS)
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500 dark:text-slate-400">
            Certificate chain (PEM)
          </label>
          <textarea
            value={request.clientCertPem}
            onChange={(e) => patch({ clientCertPem: e.target.value })}
            placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"}
            spellCheck={false}
            rows={4}
            className={textareaCls}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500 dark:text-slate-400">
            Private key (PEM — PKCS#8, PKCS#1 or SEC1)
          </label>
          <textarea
            value={request.clientKeyPem}
            onChange={(e) => patch({ clientKeyPem: e.target.value })}
            placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
            spellCheck={false}
            rows={4}
            className={textareaCls}
          />
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Presented to servers that request a client certificate. Both fields are
          required together. Keys are kept only with this request.
        </p>
      </div>
    </div>
  );
}

function AuthEditor() {
  const auth = useStore((s) => s.request.auth);
  const patch = useStore((s) => s.patch);
  const setAuth = (partial: Partial<Auth>) =>
    patch({ auth: { ...auth, ...partial } });

  return (
    <div className="max-w-xl space-y-3">
      <Field label="Type">
        <Select
          value={auth.kind}
          onChange={(e) => setAuth({ kind: e.target.value as Auth["kind"] })}
        >
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
        </Select>
      </Field>

      {auth.kind === "bearer" && (
        <Field label="Token">
          <TextInput
            value={auth.token}
            onChange={(e) => setAuth({ token: e.target.value })}
            placeholder="eyJhbGci…"
            className="font-mono"
          />
        </Field>
      )}

      {auth.kind === "basic" && (
        <>
          <Field label="Username">
            <TextInput
              value={auth.username}
              onChange={(e) => setAuth({ username: e.target.value })}
            />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              value={auth.password}
              onChange={(e) => setAuth({ password: e.target.value })}
            />
          </Field>
        </>
      )}

      {auth.kind === "apikey" && (
        <>
          <Field label="Key">
            <TextInput
              value={auth.apiKeyName}
              onChange={(e) => setAuth({ apiKeyName: e.target.value })}
              placeholder="X-API-Key"
            />
          </Field>
          <Field label="Value">
            <TextInput
              value={auth.apiKeyValue}
              onChange={(e) => setAuth({ apiKeyValue: e.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label="Add to">
            <Select
              value={auth.apiKeyIn}
              onChange={(e) =>
                setAuth({ apiKeyIn: e.target.value as "header" | "query" })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query param</option>
            </Select>
          </Field>
        </>
      )}

      {auth.kind === "none" && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          This request will be sent without authentication.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-24 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SaveControl() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useStore((s) => s.request);
  const saveCurrent = useStore((s) => s.saveCurrent);
  const updateCollectionRequest = useStore((s) => s.updateCollectionRequest);
  const source = useStore((s) => s.collectionSource);

  const clearTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  useEffect(() => clearTimer, []); // clear any pending timer on unmount

  const close = () => {
    clearTimer();
    setOpen(false);
  };

  const openDialog = () => {
    clearTimer(); // cancel a stale auto-close from a previous save
    // Prefer the current request name; otherwise derive one from the URL.
    let def = useStore.getState().requestName.trim();
    if (!def) {
      try {
        const u = new URL(
          request.url.includes("://") ? request.url : `https://${request.url}`,
        );
        def = `${request.method} ${u.host}${u.pathname === "/" ? "" : u.pathname}`;
      } catch {
        def = "Untitled request";
      }
    }
    setName(def);
    setMsg(null);
    setOpen(true);
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: ok, ok: true });
      clearTimer();
      closeTimer.current = setTimeout(() => setOpen(false), 650);
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const update = () => run(() => updateCollectionRequest(), "Updated in collection");
  const saveNew = () => {
    if (!name.trim()) return;
    run(() => saveCurrent(name), "Saved");
  };

  return (
    <>
      <Button variant="subtle" onClick={openDialog} title="Save request">
        <Save size={15} />
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={close}
        >
          <Panel className="w-96 max-w-[90vw] p-4 shadow-2xl">
            <div onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Save request
              </div>

              {source && (
                <>
                  <button
                    onClick={update}
                    disabled={busy}
                    className="no-drag flex w-full items-center gap-2 rounded-lg border border-indigo-300/50 bg-indigo-50 px-3 py-2 text-left text-xs transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20"
                  >
                    <Save size={14} className="shrink-0 text-indigo-500" />
                    <span className="min-w-0">
                      <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                        Update “{source.itemName}”
                      </span>
                      <span className="block truncate text-indigo-600/70 dark:text-indigo-300/60">
                        in {source.collectionName}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-white/[0.08]" />
                    or save as a new request
                    <div className="h-px flex-1 bg-slate-200 dark:bg-white/[0.08]" />
                  </div>
                </>
              )}

              <TextInput
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveNew();
                  if (e.key === "Escape") close();
                }}
                placeholder="Request name"
              />
              {msg && (
                <div className={cx("text-xs", msg.ok ? "text-emerald-500" : "text-rose-500")}>
                  {msg.text}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={saveNew} disabled={busy || !name.trim()}>
                  {source ? "Save as new" : "Save"}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function ImportCurlControl() {
  const setRequest = useStore((s) => s.setRequest);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const doImport = () => {
    const parsed = parseCurl(text);
    if (!parsed) {
      setErr("That doesn't look like a cURL command.");
      return;
    }
    setRequest(parsed);
    setOpen(false);
    setText("");
    setErr(null);
  };

  return (
    <>
      <Button variant="subtle" onClick={() => setOpen(true)} title="Import from cURL">
        <ClipboardPaste size={15} />
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <Panel className="w-[34rem] max-w-[90vw] p-4 shadow-2xl">
            <div onClick={(e) => e.stopPropagation()} className="space-y-3">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Import from cURL
              </div>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setErr(null);
                }}
                placeholder="curl 'https://api.example.com/users' -H 'Authorization: Bearer …'"
                className="no-drag h-40 w-full resize-none rounded-lg border border-slate-200 bg-white p-2 font-mono text-xs text-slate-800 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100"
                spellCheck={false}
              />
              {err && <div className="text-xs text-rose-500">{err}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={doImport}>
                  Import
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function CopyAsControl() {
  const request = useStore((s) => s.request);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (id: string, gen: (r: typeof request) => string) => {
    try {
      await navigator.clipboard.writeText(gen(request));
      setCopied(id);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button variant="subtle" onClick={() => setOpen((o) => !o)} title="Copy as code">
        <Code2 size={15} />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#141925]">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Copy as
            </div>
            {GENERATORS.map((g) => (
              <button
                key={g.id}
                onClick={() => copy(g.id, g.gen)}
                className="no-drag flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.06]"
              >
                {g.label}
                {copied === g.id && <Check size={13} className="text-emerald-500" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
