// Parse Postman exports (Collection v2.0 / v2.1 and environment files) into
// Pulse collections + environments. Tolerant of the many shapes Postman emits:
// a single collection, an array of them, or a data-dump with `collections` /
// `environments` arrays.

import type {
  Auth,
  Body,
  Collection,
  CollectionItem,
  HttpRequest,
  KeyValue,
  SavedEnvironment,
} from "./types";
import { defaultAuth, defaultBody, defaultRequest } from "./samples";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PostmanImport {
  collections: Collection[];
  environments: SavedEnvironment[];
  requestCount: number;
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function authVal(arr: any, key: string): string {
  if (Array.isArray(arr)) {
    const hit = arr.find((e) => e && e.key === key);
    return hit ? String(hit.value ?? "") : "";
  }
  if (arr && typeof arr === "object" && key in arr) return String(arr[key] ?? "");
  return "";
}

function mapAuth(a: any): Auth {
  const auth = defaultAuth();
  if (!a || !a.type || a.type === "noauth") return auth;
  switch (a.type) {
    case "bearer":
      auth.kind = "bearer";
      auth.token = authVal(a.bearer, "token");
      break;
    case "basic":
      auth.kind = "basic";
      auth.username = authVal(a.basic, "username");
      auth.password = authVal(a.basic, "password");
      break;
    case "apikey": {
      auth.kind = "apikey";
      auth.apiKeyName = authVal(a.apikey, "key");
      auth.apiKeyValue = authVal(a.apikey, "value");
      auth.apiKeyIn = authVal(a.apikey, "in") === "query" ? "query" : "header";
      break;
    }
    default:
      // oauth2 / digest / etc. are not represented — leave as "none".
      break;
  }
  return auth;
}

function parseQueryString(qs: string): KeyValue[] {
  return qs
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      const k = i >= 0 ? pair.slice(0, i) : pair;
      const v = i >= 0 ? pair.slice(i + 1) : "";
      return { enabled: true, key: decodeSafe(k), value: decodeSafe(v) };
    });
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function mapUrl(url: any): { base: string; query: KeyValue[] } {
  let raw = typeof url === "string" ? url : (url?.raw ?? "");

  // `raw` is optional in v2.1 — many generators emit only structured parts.
  if (!raw && url && typeof url === "object") {
    const protocol = url.protocol ? `${url.protocol}://` : "";
    const host = Array.isArray(url.host) ? url.host.join(".") : String(url.host ?? "");
    const port = url.port ? `:${url.port}` : "";
    const pathParts = Array.isArray(url.path)
      ? url.path.map((p: any) => (p && typeof p === "object" ? String(p.value ?? "") : String(p)))
      : url.path
        ? [String(url.path)]
        : [];
    const path = pathParts.join("/").replace(/^\/+/, "");
    raw = `${protocol}${host}${port}${path ? "/" + path : ""}`;
  }

  const qIndex = raw.indexOf("?");
  const base = qIndex >= 0 ? raw.slice(0, qIndex) : raw;

  let query: KeyValue[] = [];
  if (url && typeof url === "object" && Array.isArray(url.query) && url.query.length) {
    query = url.query
      .filter((q: any) => q && q.key)
      .map((q: any) => ({ enabled: q.disabled !== true, key: String(q.key), value: String(q.value ?? "") }));
  } else if (qIndex >= 0) {
    query = parseQueryString(raw.slice(qIndex + 1));
  }
  return { base, query };
}

function mapHeaders(header: any): KeyValue[] {
  if (!Array.isArray(header)) return [];
  return header
    .filter((h) => h && h.key)
    .map((h) => ({ enabled: h.disabled !== true, key: String(h.key), value: String(h.value ?? "") }));
}

function mapBody(body: any): Body {
  const b = defaultBody();
  if (!body || !body.mode) return b;
  switch (body.mode) {
    case "raw": {
      const lang = body.options?.raw?.language;
      b.mode = lang === "json" ? "json" : "text";
      b.raw = String(body.raw ?? "");
      break;
    }
    case "urlencoded":
      b.mode = "form";
      b.form = (body.urlencoded ?? [])
        .filter((d: any) => d && d.key)
        .map((d: any) => ({ enabled: d.disabled !== true, key: String(d.key), value: String(d.value ?? "") }));
      break;
    case "formdata":
      b.mode = "multipart";
      b.multipart = (body.formdata ?? [])
        .filter((d: any) => d && d.key)
        .map((d: any) => ({
          enabled: d.disabled !== true,
          key: String(d.key),
          kind: d.type === "file" ? "file" : "text",
          value: d.type === "file" ? String(d.src ?? "") : String(d.value ?? ""),
        }));
      break;
    case "graphql":
      b.mode = "graphql";
      b.raw = String(body.graphql?.query ?? "");
      b.graphqlVariables =
        typeof body.graphql?.variables === "string"
          ? body.graphql.variables
          : JSON.stringify(body.graphql?.variables ?? {}, null, 2);
      break;
    case "file":
      b.mode = "binary";
      b.binaryPath = String(body.file?.src ?? "");
      break;
    default:
      break;
  }
  return b;
}

function mapRequest(pReq: any): HttpRequest {
  const req = defaultRequest();
  if (typeof pReq === "string") {
    req.url = pReq;
    return req;
  }
  req.method = String(pReq.method ?? "GET").toUpperCase();
  const { base, query } = mapUrl(pReq.url);
  req.url = base;
  req.queryParams = query;
  req.headers = mapHeaders(pReq.header);
  req.body = mapBody(pReq.body);
  req.auth = mapAuth(pReq.auth);
  return req;
}

/** Join a Postman event's script lines (prerequest / test). */
function scriptFromEvents(events: any, listen: string): string {
  if (!Array.isArray(events)) return "";
  const ev = events.find((e) => e && e.listen === listen && e.disabled !== true);
  const exec = ev?.script?.exec;
  if (Array.isArray(exec)) return exec.join("\n");
  if (typeof exec === "string") return exec;
  return "";
}

function mapItems(items: any[]): CollectionItem[] {
  if (!Array.isArray(items)) return [];
  const out: CollectionItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if (Array.isArray(it.item)) {
      // Folder
      out.push({
        id: uid(),
        name: String(it.name ?? "Folder"),
        kind: "folder",
        children: mapItems(it.item),
      });
    } else if (it.request) {
      const request = mapRequest(it.request);
      request.preRequestScript = scriptFromEvents(it.event, "prerequest");
      request.postResponseScript = scriptFromEvents(it.event, "test");
      out.push({
        id: uid(),
        name: String(it.name ?? "Request"),
        kind: "request",
        request,
        children: [],
      });
    }
  }
  return out;
}

function countRequests(items: CollectionItem[]): number {
  let n = 0;
  for (const it of items) {
    if (it.kind === "request") n++;
    else n += countRequests(it.children ?? []);
  }
  return n;
}

function isCollection(obj: any): boolean {
  return obj && typeof obj === "object" && Array.isArray(obj.item);
}

function isEnvironment(obj: any): boolean {
  return (
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.values) &&
    (obj._postman_variable_scope === "environment" || typeof obj.name === "string")
  );
}

function mapEnvironment(obj: any): SavedEnvironment {
  return {
    id: "",
    name: String(obj.name ?? "Imported environment"),
    variables: (obj.values ?? [])
      .filter((v: any) => v && v.key)
      .map((v: any) => ({ enabled: v.enabled !== false, key: String(v.key), value: String(v.value ?? "") })),
    createdAt: 0,
    updatedAt: 0,
  };
}

function mapCollection(obj: any): Collection {
  const items = mapItems(obj.item);
  return {
    id: "",
    name: String(obj.info?.name ?? obj.name ?? "Imported collection"),
    items,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Parse one Postman export file's JSON text. Throws on invalid JSON. */
export function parsePostman(jsonText: string): PostmanImport {
  const data = JSON.parse(jsonText);
  const collections: Collection[] = [];
  const environments: SavedEnvironment[] = [];

  const roots: any[] = Array.isArray(data) ? data : [data];

  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    // Data-dump shape: { collections: [...], environments: [...] }
    if (Array.isArray(root.collections)) {
      for (const c of root.collections) if (isCollection(c)) collections.push(mapCollection(c));
    }
    if (Array.isArray(root.environments)) {
      for (const e of root.environments) if (isEnvironment(e)) environments.push(mapEnvironment(e));
    }
    if (isCollection(root)) {
      const col = mapCollection(root);
      // Collection-level variables become an environment so {{var}} resolves.
      if (Array.isArray(root.variable) && root.variable.length) {
        environments.push({
          id: "",
          name: `${col.name} (vars)`,
          variables: root.variable
            .filter((v: any) => v && v.key)
            .map((v: any) => ({ enabled: v.disabled !== true, key: String(v.key), value: String(v.value ?? "") })),
          createdAt: 0,
          updatedAt: 0,
        });
      }
      collections.push(col);
    } else if (isEnvironment(root)) {
      environments.push(mapEnvironment(root));
    }
  }

  const requestCount = collections.reduce((n, c) => n + countRequests(c.items), 0);
  return { collections, environments, requestCount };
}
