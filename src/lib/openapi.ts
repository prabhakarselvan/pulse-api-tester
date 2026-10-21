// Parse an OpenAPI 3.x / Swagger 2.0 spec (JSON or YAML) into a Pulse collection,
// generating example request bodies from the declared schemas.

import { load as loadYaml } from "js-yaml";
import type { Auth, Collection, CollectionItem, HttpRequest, KeyValue } from "./types";
import { defaultRequest } from "./samples";

export interface OpenApiImport {
  collection: Collection;
  requestCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function loadSpec(text: string): Json {
  const t = text.trim();
  if (!t) throw new Error("The document is empty.");
  try {
    return JSON.parse(t);
  } catch {
    /* not JSON — try YAML */
  }
  try {
    return loadYaml(t);
  } catch {
    throw new Error("Could not parse the document as JSON or YAML.");
  }
}

function resolveRef(ref: string, root: Json): Json {
  // e.g. "#/components/schemas/Pet" or "#/definitions/Pet"
  if (!ref.startsWith("#/")) return {};
  let node: Json = root;
  for (const seg of ref.slice(2).split("/")) {
    const key = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node?.[key];
    if (node == null) return {};
  }
  return node;
}

/** Build a sample value from a JSON Schema (bounded depth; resolves $ref). */
function sampleFromSchema(schema: Json, root: Json, depth = 0): Json {
  if (!schema || typeof schema !== "object" || depth > 6) return null;
  if (schema.$ref) return sampleFromSchema(resolveRef(schema.$ref, root), root, depth + 1);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (schema.allOf) {
    return Object.assign(
      {},
      ...schema.allOf.map((s: Json) => sampleFromSchema(s, root, depth + 1)).filter(Boolean),
    );
  }
  if (schema.oneOf || schema.anyOf) {
    return sampleFromSchema((schema.oneOf ?? schema.anyOf)[0], root, depth + 1);
  }

  const type = schema.type ?? (schema.properties ? "object" : undefined);
  switch (type) {
    case "object": {
      const obj: Record<string, Json> = {};
      const props = schema.properties ?? {};
      for (const k of Object.keys(props)) obj[k] = sampleFromSchema(props[k], root, depth + 1);
      return obj;
    }
    case "array":
      return [sampleFromSchema(schema.items ?? {}, root, depth + 1)];
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "string":
      if (schema.format === "date-time") return "1970-01-01T00:00:00Z";
      if (schema.format === "date") return "1970-01-01";
      if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (schema.format === "email") return "user@example.com";
      return "string";
    default:
      return null;
  }
}

function kv(key: string, value = ""): KeyValue {
  return { enabled: true, key, value };
}

/** Determine the base URL for requests from a v3 `servers` / v2 host+basePath. */
function baseUrl(spec: Json, isV3: boolean, hint?: string): string {
  if (isV3) {
    let url: string = spec.servers?.[0]?.url ?? "";
    // Substitute server variables with their defaults.
    const vars = spec.servers?.[0]?.variables ?? {};
    for (const [name, v] of Object.entries<Json>(vars)) {
      url = url.replace(new RegExp(`\\{${name}\\}`, "g"), String(v?.default ?? ""));
    }
    if (url && !/^https?:\/\//i.test(url) && hint) {
      try {
        return new URL(url, hint).toString().replace(/\/$/, "");
      } catch {
        /* ignore */
      }
    }
    return url.replace(/\/$/, "");
  }
  const scheme = spec.schemes?.[0] ?? (hint?.startsWith("http://") ? "http" : "https");
  const host = spec.host ?? (hint ? safeHost(hint) : "");
  const basePath = spec.basePath ?? "";
  return host ? `${scheme}://${host}${basePath}`.replace(/\/$/, "") : "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Apply the first usable security scheme as a placeholder auth on the request. */
function detectAuth(spec: Json, isV3: boolean): Partial<Auth> | null {
  const schemes: Record<string, Json> = isV3
    ? (spec.components?.securitySchemes ?? {})
    : (spec.securityDefinitions ?? {});
  for (const s of Object.values(schemes)) {
    const type = String(s?.type ?? "").toLowerCase();
    if (type === "http" && String(s.scheme ?? "").toLowerCase() === "bearer") {
      return { kind: "bearer" };
    }
    if (type === "oauth2") return { kind: "bearer" };
    if (type === "apikey" && (s.in === "header" || s.in === "query")) {
      return { kind: "apikey", apiKeyName: String(s.name ?? "X-API-Key"), apiKeyIn: s.in };
    }
    if (type === "basic") return { kind: "basic" };
  }
  return null;
}

export function parseOpenApi(text: string, urlHint?: string): OpenApiImport {
  const spec = loadSpec(text);
  if (!spec || typeof spec !== "object") {
    throw new Error("Not a valid OpenAPI/Swagger document.");
  }
  const isV3 = typeof spec.openapi === "string" && spec.openapi.startsWith("3");
  const isV2 = String(spec.swagger ?? "").startsWith("2");
  if (!isV3 && !isV2) {
    throw new Error("Unrecognized spec — expected OpenAPI 3.x or Swagger 2.0.");
  }

  const base = baseUrl(spec, isV3, urlHint);
  const auth = detectAuth(spec, isV3);
  const paths: Json = spec.paths ?? {};

  // Group requests into folders by first tag.
  const folders = new Map<string, CollectionItem[]>();
  let requestCount = 0;

  for (const path of Object.keys(paths)) {
    const pathItem = paths[path] ?? {};
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const req: HttpRequest = defaultRequest();
      req.method = method.toUpperCase();
      req.url = `${base}${path}`;

      // Parameters (merge path-level + operation-level).
      const params: Json[] = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map((p) =>
        p?.$ref ? resolveRef(p.$ref, spec) : p,
      );
      for (const p of params) {
        if (!p?.name) continue;
        if (p.in === "query") req.queryParams.push({ ...kv(p.name), enabled: !!p.required });
        else if (p.in === "header") req.headers.push(kv(p.name));
        else if (p.in === "body" && p.schema) {
          const sample = sampleFromSchema(p.schema, spec);
          req.body = { ...req.body, mode: "json", raw: JSON.stringify(sample, null, 2) };
        }
      }

      // v3 request body.
      const content = op.requestBody?.content;
      if (content) {
        const jsonCt =
          content["application/json"] ??
          content[Object.keys(content).find((k) => k.includes("json")) ?? ""];
        if (jsonCt?.schema) {
          const sample = sampleFromSchema(jsonCt.schema, spec);
          req.body = { ...req.body, mode: "json", raw: JSON.stringify(sample, null, 2) };
        }
      }

      if (auth) req.auth = { ...req.auth, ...auth };

      const name = op.summary || op.operationId || `${req.method} ${path}`;
      const tag = (op.tags?.[0] as string) || "default";
      const item: CollectionItem = {
        id: crypto.randomUUID(),
        name,
        kind: "request",
        request: req,
        children: [],
      };
      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag)!.push(item);
      requestCount++;
    }
  }

  // Build the collection: one folder per tag (skip the folder when only "default").
  const tags = [...folders.keys()];
  let items: CollectionItem[];
  if (tags.length === 1 && tags[0] === "default") {
    items = folders.get("default")!;
  } else {
    items = tags.map((tag) => ({
      id: crypto.randomUUID(),
      name: tag,
      kind: "folder" as const,
      request: null,
      children: folders.get(tag)!,
    }));
  }

  const collection: Collection = {
    id: "",
    name: spec.info?.title || "Imported API",
    items,
    createdAt: 0,
    updatedAt: 0,
  };

  if (requestCount === 0) {
    throw new Error("No operations found in the spec.");
  }
  return { collection, requestCount };
}
