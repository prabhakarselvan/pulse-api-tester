// TypeScript mirror of the Rust data contract in `src-tauri/src/model.rs`.
// Field names are camelCase to match serde's `rename_all = "camelCase"`.

export interface KeyValue {
  enabled: boolean;
  key: string;
  value: string;
}

export type BodyMode =
  | "none"
  | "json"
  | "text"
  | "form"
  | "multipart"
  | "binary"
  | "graphql"
  | "soap";

export interface MultipartField {
  enabled: boolean;
  key: string;
  kind: "text" | "file";
  value: string;
}

export interface Body {
  mode: BodyMode;
  raw: string;
  form: KeyValue[];
  multipart: MultipartField[];
  graphqlVariables: string;
  binaryPath: string;
  soapVersion: "1.1" | "1.2";
  soapAction: string;
}

export type AuthKind = "none" | "bearer" | "basic" | "apikey";

export interface Auth {
  kind: AuthKind;
  token: string;
  username: string;
  password: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: "header" | "query";
}

export interface HttpRequest {
  method: string;
  url: string;
  queryParams: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
  followRedirects: boolean;
  timeoutMs: number;
  verifyTls: boolean;
  preRequestScript: string;
  postResponseScript: string;
  reuseConnection: boolean;
  proxyUrl: string;
  clientCertPem: string;
  clientKeyPem: string;
}

export interface Timings {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  downloadMs: number;
  totalMs: number;
}

export interface DnsInfo {
  resolver: string[];
  addresses: string[];
  usedAddress: string | null;
  ttl: number | null;
  lookupMs: number;
  wasIpLiteral: boolean;
}

export interface CertInfo {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  notBeforeTs: number | null;
  notAfterTs: number | null;
  san: string[];
  serial: string;
  signatureAlgorithm: string;
  fingerprintSha256: string;
  isCa: boolean;
}

export interface TlsInfo {
  version: string;
  cipherSuite: string;
  alpn: string | null;
  certificates: CertInfo[];
}

export interface Connection {
  localAddr: string | null;
  remoteAddr: string | null;
  httpVersion: string;
}

export interface RedirectHop {
  status: number;
  url: string;
  location: string;
}

export interface Hop {
  method: string;
  url: string;
  status: number;
  statusText: string;
  httpVersion: string;
  remoteAddr: string | null;
  timings: Timings;
}

export interface NetworkInfo {
  dns: DnsInfo;
  tls: TlsInfo | null;
  connection: Connection;
  redirects: RedirectHop[];
  hops: Hop[];
  requestSizeBytes: number;
  responseSizeBytes: number;
  scheme: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: KeyValue[];
  body: string;
  bodyBase64: string | null;
  contentType: string | null;
  timings: Timings;
  network: NetworkInfo;
  finalUrl: string;
  bodySizeBytes: number;
  rawRequest: string;
  rawResponseHead: string;
}

export interface SavedRequest {
  id: string;
  name: string;
  request: HttpRequest;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id: string;
  request: HttpRequest;
  status: number | null;
  totalMs: number;
  ok: boolean;
  createdAt: number;
}

export interface SavedEnvironment {
  id: string;
  name: string;
  variables: KeyValue[];
  createdAt: number;
  updatedAt: number;
}

export interface CollectionItem {
  id: string;
  name: string;
  kind: "folder" | "request";
  request?: HttpRequest | null;
  children: CollectionItem[];
}

export interface Collection {
  id: string;
  name: string;
  items: CollectionItem[];
  createdAt: number;
  updatedAt: number;
}
