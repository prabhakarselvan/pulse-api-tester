import { create } from "zustand";
import * as api from "./lib/api";
import type {
  Collection,
  CollectionItem,
  HistoryEntry,
  HttpRequest,
  HttpResponse,
  NetworkInfo,
  SavedEnvironment,
  SavedRequest,
  Timings,
} from "./lib/types";
import type { StreamEvent } from "./lib/api";
import { defaultRequest } from "./lib/samples";
import { parsePostman } from "./lib/postman";
import { runScript, type LogLine, type TestResult } from "./lib/scripting";

export type SidebarTab = "history" | "saved" | "collections";

export interface ImportSummary {
  collections: number;
  requests: number;
  environments: number;
}
export type BuilderTab =
  | "params"
  | "headers"
  | "auth"
  | "body"
  | "scripts"
  | "network";
export type ResponseTab =
  | "body"
  | "headers"
  | "cookies"
  | "network"
  | "flow"
  | "wire"
  | "diff"
  | "security"
  | "profile"
  | "tests";
export type BodyView = "pretty" | "raw" | "preview";

/** Protocol the request builder is driving. */
export type RequestMode = "http" | "ws" | "sse";

export type RtStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface RtMessage {
  id: number;
  direction: "sent" | "received" | "info" | "error" | "system";
  text: string;
  bytes?: number;
  binary?: boolean;
  at: number;
}

/** State of the single active realtime (WebSocket/SSE) connection. */
export interface RealtimeState {
  status: RtStatus;
  protocol: string;
  connId: string | null;
  messages: RtMessage[];
  open: { timings: Timings; network: NetworkInfo; status: number | null } | null;
  error: string | null;
}

export interface ProfileState {
  running: boolean;
  done: number;
  total: number;
  results: Timings[];
}
export type Theme = "dark" | "light";
export type Layout = "horizontal" | "vertical";

/** One workspace tab: an independent request + its result and UI state. */
export interface Tab {
  id: string;
  name: string;
  request: HttpRequest;
  response: HttpResponse | null;
  error: string | null;
  loading: boolean;
  activeId: string | null;
  builderTab: BuilderTab;
  responseTab: ResponseTab;
  bodyView: BodyView;
  requestMode: RequestMode;
  profile: ProfileState | null;
  testResults: TestResult[];
  scriptLogs: LogLine[];
}

/** Tiny localStorage helper (persists simple UI prefs). */
const LS = {
  get(k: string, fallback: string): string {
    try {
      return localStorage.getItem(k) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

interface State {
  // Theme + layout
  theme: Theme;
  toggleTheme: () => void;
  layout: Layout;
  toggleLayout: () => void;

  // Sidebar search.
  sidebarQuery: string;
  setSidebarQuery: (q: string) => void;

  // Scripting.
  scriptVars: Record<string, string>;
  testResults: TestResult[];
  scriptLogs: LogLine[];
  applyScriptVars: (before: Record<string, string>, after: Record<string, string>) => Promise<void>;

  // Tabs (workspace) — the flat fields below mirror the ACTIVE tab's live state.
  tabs: Tab[];
  activeTabId: string;
  newTab: () => void;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  updateTab: (tabId: string, partial: Partial<Omit<Tab, "id">>) => void;

  // The request being edited + its result (active tab's live state).
  requestName: string;
  request: HttpRequest;
  response: HttpResponse | null;
  error: string | null;
  loading: boolean;
  activeId: string | null; // id of the loaded saved request, if any

  // Collections + history.
  saved: SavedRequest[];
  history: HistoryEntry[];

  // Collections.
  collections: Collection[];

  // Environments + variables.
  envs: SavedEnvironment[];
  activeEnvId: string | null;

  // Latency profiler.
  profile: ProfileState | null;

  // Response A/B compare: a pinned baseline response to diff the current one against.
  diffBaseline: HttpResponse | null;
  pinDiffBaseline: () => void;
  clearDiffBaseline: () => void;

  // UI state.
  sidebarTab: SidebarTab;
  builderTab: BuilderTab;
  responseTab: ResponseTab;
  bodyView: BodyView;
  requestMode: RequestMode;

  // Realtime (WebSocket / SSE) — one active connection at a time.
  rt: RealtimeState;
  rtConnect: () => Promise<void>;
  rtSend: (text: string) => Promise<void>;
  rtDisconnect: () => Promise<void>;
  rtClear: () => void;
  setRequestMode: (m: RequestMode) => void;

  // Request editing.
  setRequest: (r: HttpRequest) => void;
  setRequestName: (name: string) => void;
  patch: (partial: Partial<HttpRequest>) => void;
  newRequest: () => void;

  // Networking.
  send: () => Promise<void>;

  // Persistence.
  init: () => Promise<void>;
  refreshSaved: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  saveCurrent: (name: string) => Promise<void>;
  removeSaved: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  loadSaved: (item: SavedRequest) => void;
  loadHistory: (entry: HistoryEntry) => void;
  loadRequest: (req: HttpRequest, name?: string) => void;

  // Collections.
  refreshCollections: () => Promise<void>;
  upsertCollection: (c: Collection) => Promise<Collection>;
  removeCollection: (id: string) => Promise<void>;
  addToCollection: (collectionId: string, name: string) => Promise<void>;
  importPostman: (jsonTexts: string[]) => Promise<ImportSummary>;

  // Environments.
  refreshEnvs: () => Promise<void>;
  upsertEnv: (env: SavedEnvironment) => Promise<void>;
  removeEnv: (id: string) => Promise<void>;
  setActiveEnvId: (id: string | null) => Promise<void>;
  activeVars: () => Record<string, string>;

  // Profiler.
  runProfile: (n: number) => Promise<void>;
  clearProfile: () => void;

  // UI setters.
  setSidebarTab: (t: SidebarTab) => void;
  setBuilderTab: (t: BuilderTab) => void;
  setResponseTab: (t: ResponseTab) => void;
  setBodyView: (v: BodyView) => void;
}

const freshTab = (): Tab => ({
  id: crypto.randomUUID(),
  name: "",
  request: defaultRequest(),
  response: null,
  error: null,
  loading: false,
  activeId: null,
  builderTab: "params",
  responseTab: "body",
  bodyView: "pretty",
  requestMode: "http",
  profile: null,
  testResults: [],
  scriptLogs: [],
});

const flatFromTab = (t: Tab) => ({
  requestName: t.name,
  request: t.request,
  response: t.response,
  error: t.error,
  loading: t.loading,
  activeId: t.activeId,
  builderTab: t.builderTab,
  responseTab: t.responseTab,
  bodyView: t.bodyView,
  requestMode: t.requestMode,
  profile: t.profile,
  testResults: t.testResults,
  scriptLogs: t.scriptLogs,
});

// Realtime message helpers (module-level; no store access needed).
let rtMsgSeq = 0;
// Monotonic connection epoch: every connect/disconnect bumps it so events from a
// torn-down connection (e.g. its trailing "closed") can't clobber a newer one.
let rtEpoch = 0;
const freshRt = (): RealtimeState => ({
  status: "idle",
  protocol: "",
  connId: null,
  messages: [],
  open: null,
  error: null,
});
const RT_MSG_CAP = 500;
function appendMsg(
  list: RtMessage[],
  direction: RtMessage["direction"],
  text: string,
  extra?: { bytes?: number; binary?: boolean },
): RtMessage[] {
  const msg: RtMessage = {
    id: ++rtMsgSeq,
    direction,
    text,
    at: Date.now(),
    ...extra,
  };
  const next = [...list, msg];
  return next.length > RT_MSG_CAP ? next.slice(next.length - RT_MSG_CAP) : next;
}

// Per-tab request tokens: bumping invalidates any in-flight send/profile for
// that tab so a stale result never lands on a reset / reloaded request.
const reqTokens = new Map<string, number>();
const bumpToken = (tabId: string): number => {
  const n = (reqTokens.get(tabId) ?? 0) + 1;
  reqTokens.set(tabId, n);
  return n;
};

export const useStore = create<State>((set, get) => {
  const snapshotActive = (): Tab => {
    const s = get();
    return {
      id: s.activeTabId,
      name: s.requestName,
      request: s.request,
      response: s.response,
      error: s.error,
      loading: s.loading,
      activeId: s.activeId,
      builderTab: s.builderTab,
      responseTab: s.responseTab,
      bodyView: s.bodyView,
      requestMode: s.requestMode,
      profile: s.profile,
      testResults: s.testResults,
      scriptLogs: s.scriptLogs,
    };
  };
  const commitActive = (): Tab[] =>
    get().tabs.map((t) => (t.id === get().activeTabId ? snapshotActive() : t));

  // Dispatch a realtime stream event into the `rt` slice.
  const handleStreamEvent = (ev: StreamEvent) => {
    switch (ev.kind) {
      case "open":
        set((s) => ({
          rt: {
            ...s.rt,
            status: "open",
            open: { timings: ev.timings, network: ev.network, status: ev.status },
            messages: appendMsg(
              s.rt.messages,
              "system",
              `Connected (${ev.protocol}${ev.status != null ? `, HTTP ${ev.status}` : ""})`,
            ),
          },
        }));
        break;
      case "message":
        set((s) => ({
          rt: {
            ...s.rt,
            messages: appendMsg(s.rt.messages, ev.direction, ev.data, {
              bytes: ev.bytes,
              binary: ev.binary,
            }),
          },
        }));
        break;
      case "info":
        set((s) => ({
          rt: { ...s.rt, messages: appendMsg(s.rt.messages, "info", ev.message) },
        }));
        break;
      case "error":
        set((s) => ({
          rt: {
            ...s.rt,
            status: "error",
            error: ev.message,
            messages: appendMsg(s.rt.messages, "error", ev.message),
          },
        }));
        break;
      case "closed":
        set((s) => ({
          rt: {
            ...s.rt,
            status: s.rt.status === "error" ? "error" : "closed",
            connId: null,
            messages: appendMsg(s.rt.messages, "system", `Closed: ${ev.reason}`),
          },
        }));
        break;
    }
  };
  const persistTabs = () => {
    try {
      const committed = commitActive();
      LS.set(
        "pulse.tabs",
        JSON.stringify({
          activeTabId: get().activeTabId,
          tabs: committed.map((t) => ({ id: t.id, name: t.name, request: t.request, activeId: t.activeId })),
        }),
      );
    } catch {
      /* ignore */
    }
  };
  const first = freshTab();

  return {
  theme: LS.get("pulse.theme", "dark") as Theme,
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    set({ theme: next });
    LS.set("pulse.theme", next);
  },
  layout: LS.get("pulse.layout", "horizontal") as Layout,
  toggleLayout: () => {
    const next = get().layout === "horizontal" ? "vertical" : "horizontal";
    set({ layout: next });
    LS.set("pulse.layout", next);
  },

  sidebarQuery: "",
  setSidebarQuery: (q) => set({ sidebarQuery: q }),

  scriptVars: {},

  ...flatFromTab(first),
  tabs: [first],
  activeTabId: first.id,

  saved: [],
  history: [],
  collections: [],
  envs: [],
  activeEnvId: null,

  diffBaseline: null,
  pinDiffBaseline: () => set({ diffBaseline: get().response }),
  clearDiffBaseline: () => set({ diffBaseline: null }),

  rt: {
    status: "idle",
    protocol: "",
    connId: null,
    messages: [],
    open: null,
    error: null,
  },

  sidebarTab: "history",

  setRequest: (r) => set({ request: r }),
  setRequestName: (name) => set({ requestName: name }),
  patch: (partial) => set((s) => ({ request: { ...s.request, ...partial } })),
  newRequest: () => {
    bumpToken(get().activeTabId);
    set(flatFromTab(freshTab()));
    persistTabs();
  },

  // --- Tabs ---
  newTab: () => {
    const committed = commitActive();
    const tab = freshTab();
    set({ tabs: [...committed, tab], activeTabId: tab.id, ...flatFromTab(tab) });
    persistTabs();
  },
  switchTab: (id) => {
    if (id === get().activeTabId) return;
    const committed = commitActive();
    const target = committed.find((t) => t.id === id);
    if (!target) return;
    set({ tabs: committed, activeTabId: id, ...flatFromTab(target) });
    persistTabs();
  },
  closeTab: (id) => {
    bumpToken(id); // drop any in-flight result for the closed tab
    const committed = commitActive();
    const wasActive = id === get().activeTabId;
    const idx = committed.findIndex((t) => t.id === id);
    const remaining = committed.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      const tab = freshTab();
      set({ tabs: [tab], activeTabId: tab.id, ...flatFromTab(tab) });
      persistTabs();
      return;
    }
    if (wasActive) {
      const next = remaining[Math.min(idx, remaining.length - 1)];
      set({ tabs: remaining, activeTabId: next.id, ...flatFromTab(next) });
    } else {
      set({ tabs: remaining });
    }
    persistTabs();
  },
  updateTab: (tabId, partial) => {
    if (get().activeTabId === tabId) {
      set(partial);
    } else {
      set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, ...partial } : t)) });
    }
  },

  send: async () => {
    const { request } = get();
    if (!request.url.trim()) {
      set({ error: "Enter a URL to send a request." });
      return;
    }
    const tabId = get().activeTabId;
    const token = bumpToken(tabId);
    get().updateTab(tabId, {
      loading: true,
      error: null,
      response: null,
      responseTab: "body",
      testResults: [],
      scriptLogs: [],
    });

    let effective = structuredClone(request);
    let vars = get().activeVars();
    const logs: LogLine[] = [];
    const tests: TestResult[] = [];

    // Pre-request script.
    if (effective.preRequestScript && effective.preRequestScript.trim()) {
      const before = vars;
      const r = await runScript("pre", effective.preRequestScript, effective, null, { ...vars });
      effective = r.request;
      vars = r.vars;
      logs.push(...r.logs);
      if (r.error) logs.push({ level: "error", text: "Pre-request error: " + r.error });
      await get().applyScriptVars(before, r.vars);
    }

    try {
      // History records the ORIGINAL authored request (so replay re-runs scripts
      // cleanly), not the pre-script-mutated `effective`.
      const res = await api.sendRequest(effective, vars, request);

      // Post-response script.
      if (effective.postResponseScript && effective.postResponseScript.trim()) {
        const before = vars;
        const r = await runScript("post", effective.postResponseScript, effective, res, { ...vars });
        logs.push(...r.logs);
        tests.push(...r.tests);
        if (r.error) logs.push({ level: "error", text: "Test error: " + r.error });
        await get().applyScriptVars(before, r.vars);
      }

      if (reqTokens.get(tabId) === token) {
        get().updateTab(tabId, { response: res, loading: false, testResults: tests, scriptLogs: logs });
      }
    } catch (e) {
      if (reqTokens.get(tabId) === token) {
        get().updateTab(tabId, { error: String(e), loading: false, testResults: tests, scriptLogs: logs });
      }
    }
    get().refreshHistory();
    persistTabs();
  },

  init: async () => {
    // Restore the workspace tabs from the last session.
    try {
      const raw = LS.get("pulse.tabs", "");
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.tabs) && data.tabs.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tabs: Tab[] = data.tabs.map((d: any) => ({
            ...freshTab(),
            id: typeof d.id === "string" ? d.id : crypto.randomUUID(),
            name: typeof d.name === "string" ? d.name : "",
            request: { ...defaultRequest(), ...(d.request || {}) },
            activeId: d.activeId ?? null,
          }));
          const activeTabId = tabs.some((t) => t.id === data.activeTabId)
            ? data.activeTabId
            : tabs[0].id;
          const active = tabs.find((t) => t.id === activeTabId)!;
          set({ tabs, activeTabId, ...flatFromTab(active) });
        }
      }
    } catch {
      /* ignore malformed */
    }

    await Promise.all([
      get().refreshSaved(),
      get().refreshHistory(),
      get().refreshEnvs(),
      get().refreshCollections(),
    ]);
    try {
      set({ activeEnvId: await api.getActiveEnv() });
    } catch {
      /* ignore */
    }
  },

  refreshSaved: async () => {
    try {
      set({ saved: await api.listSaved() });
    } catch {
      /* ignore */
    }
  },

  refreshHistory: async () => {
    try {
      set({ history: await api.listHistory(100) });
    } catch {
      /* ignore */
    }
  },

  saveCurrent: async (name) => {
    const { request, activeId } = get();
    const item: SavedRequest = {
      id: activeId ?? "",
      name: name.trim() || "Untitled request",
      request,
      createdAt: 0,
      updatedAt: 0,
    };
    const saved = await api.saveRequest(item);
    set({ activeId: saved.id, requestName: saved.name });
    await get().refreshSaved();
  },

  removeSaved: async (id) => {
    await api.deleteSaved(id);
    if (get().activeId === id) set({ activeId: null });
    await get().refreshSaved();
  },

  clearHistory: async () => {
    await api.clearHistory();
    await get().refreshHistory();
  },

  loadSaved: (item) => {
    bumpToken(get().activeTabId);
    set({
      ...flatFromTab(freshTab()),
      request: structuredClone(item.request),
      activeId: item.id,
      requestName: item.name,
    });
    persistTabs();
  },

  loadHistory: (entry) => {
    bumpToken(get().activeTabId);
    set({ ...flatFromTab(freshTab()), request: structuredClone(entry.request) });
    persistTabs();
  },

  loadRequest: (req, name = "") => {
    bumpToken(get().activeTabId);
    set({ ...flatFromTab(freshTab()), request: structuredClone(req), requestName: name });
    persistTabs();
  },

  // --- Collections ---
  refreshCollections: async () => {
    try {
      set({ collections: await api.listCollections() });
    } catch {
      /* ignore */
    }
  },

  upsertCollection: async (c) => {
    const saved = await api.saveCollection(c);
    await get().refreshCollections();
    return saved;
  },

  removeCollection: async (id) => {
    await api.deleteCollection(id);
    await get().refreshCollections();
  },

  addToCollection: async (collectionId, name) => {
    const col = get().collections.find((c) => c.id === collectionId);
    if (!col) return;
    const item: CollectionItem = {
      id: crypto.randomUUID(),
      name: name.trim() || "Request",
      kind: "request",
      request: structuredClone(get().request),
      children: [],
    };
    await get().upsertCollection({ ...col, items: [...col.items, item] });
  },

  importPostman: async (jsonTexts) => {
    let collections = 0;
    let requests = 0;
    let environments = 0;
    for (const text of jsonTexts) {
      let parsed;
      try {
        parsed = parsePostman(text);
      } catch {
        continue; // skip invalid files
      }
      for (const c of parsed.collections) {
        await api.saveCollection(c);
        collections++;
      }
      for (const e of parsed.environments) {
        await api.saveEnv(e);
        environments++;
      }
      requests += parsed.requestCount;
    }
    await Promise.all([get().refreshCollections(), get().refreshEnvs()]);
    if (collections === 0 && environments === 0) {
      throw new Error(
        "No Postman collections or environments found. Make sure the file is a Postman v2.0/v2.1 export.",
      );
    }
    return { collections, requests, environments };
  },

  // --- Environments ---
  refreshEnvs: async () => {
    try {
      set({ envs: await api.listEnvs() });
    } catch {
      /* ignore */
    }
  },

  upsertEnv: async (env) => {
    await api.saveEnv(env);
    await get().refreshEnvs();
  },

  removeEnv: async (id) => {
    await api.deleteEnv(id);
    if (get().activeEnvId === id) await get().setActiveEnvId(null);
    await get().refreshEnvs();
  },

  setActiveEnvId: async (id) => {
    // Clear session script-vars so a previous env's script overrides don't leak.
    set({ activeEnvId: id, scriptVars: {} });
    try {
      await api.setActiveEnv(id);
    } catch {
      /* ignore */
    }
  },

  activeVars: () => {
    const env = get().envs.find((e) => e.id === get().activeEnvId);
    const map: Record<string, string> = {};
    if (env) {
      for (const v of env.variables) {
        if (v.enabled && v.key) map[v.key] = v.value;
      }
    }
    Object.assign(map, get().scriptVars); // script-set vars override env
    return map;
  },

  applyScriptVars: async (before, after) => {
    const env = get().envs.find((e) => e.id === get().activeEnvId);
    if (env) {
      // With an active environment, persist changes there (single source of
      // truth — avoids a scriptVars overlay leaking across env switches).
      let changed = false;
      let variables = env.variables.map((v) => ({ ...v }));
      for (const k of Object.keys(after)) {
        if (after[k] === before[k]) continue;
        const idx = variables.findIndex((v) => v.key === k);
        if (idx >= 0) {
          if (variables[idx].value !== after[k]) {
            variables[idx].value = after[k];
            changed = true;
          }
        } else {
          variables.push({ enabled: true, key: k, value: after[k] });
          changed = true;
        }
      }
      // Deletions (unset).
      for (const k of Object.keys(before)) {
        if (!(k in after)) {
          const n = variables.length;
          variables = variables.filter((v) => v.key !== k);
          if (variables.length !== n) changed = true;
        }
      }
      if (changed) await get().upsertEnv({ ...env, variables }); // await → serialize pre/post writes
    } else {
      // No active environment: keep a session-only variable scope.
      const next = { ...get().scriptVars };
      for (const k of Object.keys(before)) if (!(k in after)) delete next[k];
      for (const k of Object.keys(after)) if (after[k] !== before[k]) next[k] = after[k];
      set({ scriptVars: next });
    }
  },

  // --- Profiler ---
  runProfile: async (n) => {
    const { request } = get();
    if (!request.url.trim()) {
      set({ error: "Enter a URL to profile." });
      return;
    }
    const tabId = get().activeTabId;
    const token = bumpToken(tabId);
    const vars = get().activeVars();
    get().updateTab(tabId, {
      profile: { running: true, done: 0, total: n, results: [] },
      responseTab: "profile",
    });
    const results: Timings[] = [];
    for (let i = 0; i < n; i++) {
      if (reqTokens.get(tabId) !== token) return; // tab reset/closed — abort
      try {
        const r = await api.probeRequest(request, vars);
        results.push(r.timings);
      } catch {
        /* skip failed run */
      }
      if (reqTokens.get(tabId) !== token) return;
      get().updateTab(tabId, {
        profile: { running: i < n - 1, done: i + 1, total: n, results: [...results] },
      });
    }
  },

  clearProfile: () => set({ profile: null }),

  setSidebarTab: (t) => set({ sidebarTab: t }),
  setBuilderTab: (t) => set({ builderTab: t }),
  setResponseTab: (t) => set({ responseTab: t }),
  setBodyView: (v) => set({ bodyView: v }),
  setRequestMode: (m) => {
    // Switching protocol tears down any live realtime connection.
    if (m !== get().requestMode && get().rt.connId) get().rtDisconnect();
    get().updateTab(get().activeTabId, { requestMode: m });
  },

  // --- Realtime (WebSocket / SSE) ---
  rtConnect: async () => {
    // Tear down any existing connection first (single active connection).
    await get().rtDisconnect();

    const mode = get().requestMode;
    if (mode !== "ws" && mode !== "sse") return;
    const request = get().request;
    if (!request.url.trim()) {
      set({ rt: { ...freshRt(), status: "error", error: "Enter a URL to connect." } });
      return;
    }

    const myEpoch = ++rtEpoch;
    set({
      rt: {
        status: "connecting",
        protocol: mode === "ws" ? "WebSocket" : "SSE",
        connId: null,
        messages: appendMsg([], "system", `Connecting to ${request.url}…`),
        open: null,
        error: null,
      },
    });

    const channel = new api.Channel<StreamEvent>();
    // Ignore events once a newer connect/disconnect has superseded this attempt.
    channel.onmessage = (ev) => {
      if (myEpoch === rtEpoch) handleStreamEvent(ev);
    };

    try {
      const id =
        mode === "ws"
          ? await api.wsConnect(request, channel)
          : await api.sseConnect(request, channel);
      // Only adopt the id if we're still the current attempt.
      if (myEpoch === rtEpoch) set((s) => ({ rt: { ...s.rt, connId: id } }));
      else {
        // Superseded while connecting — close the now-orphaned connection.
        if (mode === "ws") api.wsClose(id).catch(() => {});
        else api.sseClose(id).catch(() => {});
      }
    } catch (e) {
      if (myEpoch === rtEpoch) set((s) => ({ rt: { ...s.rt, status: "error", error: String(e) } }));
    }
  },

  rtSend: async (text: string) => {
    const { rt } = get();
    if (rt.status !== "open" || !rt.connId) return;
    if (get().requestMode !== "ws") return; // SSE is receive-only
    try {
      await api.wsSend(rt.connId, text);
    } catch (e) {
      set((s) => ({ rt: { ...s.rt, messages: appendMsg(s.rt.messages, "error", String(e)) } }));
    }
  },

  rtDisconnect: async () => {
    const { rt } = get();
    // Orphan any events the connection we're tearing down may still emit.
    rtEpoch++;
    if (!rt.connId) {
      if (rt.status === "connecting" || rt.status === "open") {
        set((s) => ({ rt: { ...s.rt, status: "closed" } }));
      }
      return;
    }
    const id = rt.connId;
    // Set terminal state immediately — we no longer trust async trailing events.
    set((s) => ({
      rt: {
        ...s.rt,
        status: "closed",
        connId: null,
        messages: appendMsg(s.rt.messages, "system", "Disconnected"),
      },
    }));
    try {
      // Close via the ACTUAL connection's protocol, not the current mode
      // (the user may have switched tabs/mode while a socket is live).
      if (rt.protocol === "SSE") await api.sseClose(id);
      else await api.wsClose(id);
    } catch {
      /* already gone */
    }
  },

  rtClear: () => set((s) => ({ rt: { ...s.rt, messages: [] } })),
  };
});
