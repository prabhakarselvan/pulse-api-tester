// Thin wrappers around the Tauri `invoke` boundary. Argument names must match
// the Rust command parameter identifiers in `src-tauri/src/commands.rs`.

import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  Collection,
  HistoryEntry,
  HttpRequest,
  HttpResponse,
  NetworkInfo,
  SavedEnvironment,
  SavedRequest,
  Timings,
} from "./types";

export const sendRequest = (
  request: HttpRequest,
  variables?: Record<string, string>,
  historyRequest?: HttpRequest,
) => invoke<HttpResponse>("send_request", { request, variables, historyRequest });

export const probeRequest = (
  request: HttpRequest,
  variables?: Record<string, string>,
) => invoke<HttpResponse>("probe_request", { request, variables });

export const saveRequest = (item: SavedRequest) =>
  invoke<SavedRequest>("save_request", { item });

export const listSaved = () => invoke<SavedRequest[]>("list_saved");

export const deleteSaved = (id: string) => invoke<void>("delete_saved", { id });

export const listHistory = (limit = 100) =>
  invoke<HistoryEntry[]>("list_history", { limit });

export const clearHistory = () => invoke<void>("clear_history");

export const newId = () => invoke<string>("new_id");

// Environments
export const listEnvs = () => invoke<SavedEnvironment[]>("list_envs");
export const saveEnv = (item: SavedEnvironment) =>
  invoke<SavedEnvironment>("save_env", { item });
export const deleteEnv = (id: string) => invoke<void>("delete_env", { id });
export const getActiveEnv = () => invoke<string | null>("get_active_env");
export const setActiveEnv = (id: string | null) =>
  invoke<void>("set_active_env", { id });

// Collections
export const listCollections = () => invoke<Collection[]>("list_collections");
export const saveCollection = (item: Collection) =>
  invoke<Collection>("save_collection", { item });
export const deleteCollection = (id: string) =>
  invoke<void>("delete_collection", { id });
export const readTextFile = (path: string) =>
  invoke<string>("read_text_file", { path });

export const geoLookup = (ip: string) => invoke<string>("geo_lookup", { ip });

export const fetchWsdl = (url: string) => invoke<string>("fetch_wsdl", { url });

// Generic GET-as-text (the fetch_wsdl command is a plain HTTP GET returning the
// body); reused to fetch OpenAPI specs from a URL.
export const fetchText = (url: string) => invoke<string>("fetch_wsdl", { url });

// Realtime: WebSocket + SSE streaming over a Tauri Channel.
export type StreamEvent =
  | {
      kind: "open";
      protocol: string;
      status: number | null;
      timings: Timings;
      network: NetworkInfo;
    }
  | { kind: "message"; direction: "sent" | "received"; data: string; bytes: number; binary: boolean }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string }
  | { kind: "closed"; reason: string };

export { Channel };

export const wsConnect = (request: HttpRequest, onEvent: Channel<StreamEvent>) =>
  invoke<string>("ws_connect", { request, onEvent });
export const wsSend = (id: string, text: string) => invoke<void>("ws_send", { id, text });
export const wsClose = (id: string) => invoke<void>("ws_close", { id });
export const sseConnect = (request: HttpRequest, onEvent: Channel<StreamEvent>) =>
  invoke<string>("sse_connect", { request, onEvent });
export const sseClose = (id: string) => invoke<void>("sse_close", { id });
