//! Shared data contract between the Rust core and the React frontend.
//!
//! Every struct serializes as `camelCase` so the TypeScript side (see
//! `src/lib/types.ts`) can mirror these shapes 1:1. This module is the single
//! source of truth for the Tauri `invoke` boundary.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

fn default_true() -> bool {
    true
}
fn default_timeout() -> u64 {
    30_000
}

/// Current wall-clock time in epoch milliseconds (used for history timestamps).
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A toggleable key/value pair used for query params and headers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
}

/// A single field in a multipart/form-data body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub key: String,
    /// "text" | "file"
    #[serde(default)]
    pub kind: String,
    /// Text value, or an absolute file path when `kind == "file"`.
    #[serde(default)]
    pub value: String,
}

/// Request body. `mode` selects which of the sibling fields is meaningful.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Body {
    /// "none" | "json" | "text" | "form" | "multipart" | "binary" | "graphql" | "soap"
    pub mode: String,
    /// Raw text for json/text/soap (the SOAP envelope), and the query for graphql.
    #[serde(default)]
    pub raw: String,
    /// x-www-form-urlencoded fields.
    #[serde(default)]
    pub form: Vec<KeyValue>,
    /// multipart/form-data fields.
    #[serde(default)]
    pub multipart: Vec<MultipartField>,
    /// GraphQL variables (JSON text).
    #[serde(default)]
    pub graphql_variables: String,
    /// Absolute path to a file for `mode == "binary"`.
    #[serde(default)]
    pub binary_path: String,
    /// SOAP version for `mode == "soap"`: "1.1" | "1.2".
    #[serde(default = "default_soap_version")]
    pub soap_version: String,
    /// SOAP action URI (SOAPAction header for 1.1, Content-Type `action` for 1.2).
    #[serde(default)]
    pub soap_action: String,
    /// SOAP envelope XML (kept separate from `raw` so switching body modes
    /// doesn't clobber a JSON/text body).
    #[serde(default)]
    pub soap_envelope: String,
}

fn default_soap_version() -> String {
    "1.1".into()
}

impl Default for Body {
    fn default() -> Self {
        Body {
            mode: "none".into(),
            raw: String::new(),
            form: Vec::new(),
            multipart: Vec::new(),
            graphql_variables: String::new(),
            binary_path: String::new(),
            soap_version: default_soap_version(),
            soap_action: String::new(),
            soap_envelope: String::new(),
        }
    }
}

/// Authentication settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Auth {
    /// "none" | "bearer" | "basic" | "apikey"
    pub kind: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub api_key_name: String,
    #[serde(default)]
    pub api_key_value: String,
    /// "header" | "query"
    #[serde(default)]
    pub api_key_in: String,
}

impl Default for Auth {
    fn default() -> Self {
        Auth {
            kind: "none".into(),
            token: String::new(),
            username: String::new(),
            password: String::new(),
            api_key_name: String::new(),
            api_key_value: String::new(),
            api_key_in: "header".into(),
        }
    }
}

/// A full HTTP request as described by the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub query_params: Vec<KeyValue>,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    pub body: Body,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default = "default_true")]
    pub follow_redirects: bool,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_true")]
    pub verify_tls: bool,
    /// JavaScript run before the request is sent (pm-style API).
    #[serde(default)]
    pub pre_request_script: String,
    /// JavaScript run after the response arrives (tests/assertions).
    #[serde(default)]
    pub post_response_script: String,
    /// Keep-alive: reuse a pooled connection to the same origin when possible.
    #[serde(default)]
    pub reuse_connection: bool,
    /// Optional upstream HTTP proxy "host:port" or "http://host:port"
    /// (HTTPS targets are tunnelled via CONNECT).
    #[serde(default)]
    pub proxy_url: String,
    /// Optional client certificate chain (PEM) for mutual TLS.
    #[serde(default)]
    pub client_cert_pem: String,
    /// Optional client private key (PEM) for mutual TLS.
    #[serde(default)]
    pub client_key_pem: String,
}

fn default_method() -> String {
    "GET".into()
}

/// Per-phase timing breakdown, all in milliseconds.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub dns_ms: f64,
    pub tcp_ms: f64,
    pub tls_ms: f64,
    /// Time from request sent to first response byte (server processing + wait).
    pub ttfb_ms: f64,
    pub download_ms: f64,
    pub total_ms: f64,
}

/// DNS resolution detail.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsInfo {
    /// System-configured nameservers (the "resolver").
    pub resolver: Vec<String>,
    /// All resolved IP addresses.
    pub addresses: Vec<String>,
    /// The address we actually connected to.
    pub used_address: Option<String>,
    pub ttl: Option<u32>,
    pub lookup_ms: f64,
    pub was_ip_literal: bool,
}

/// One X.509 certificate in the peer chain.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    /// Validity bounds as epoch seconds (for expiry countdowns).
    pub not_before_ts: Option<i64>,
    pub not_after_ts: Option<i64>,
    pub san: Vec<String>,
    pub serial: String,
    pub signature_algorithm: String,
    pub fingerprint_sha256: String,
    pub is_ca: bool,
}

/// Negotiated TLS parameters + peer certificate chain.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsInfo {
    pub version: String,
    pub cipher_suite: String,
    pub alpn: Option<String>,
    pub certificates: Vec<CertInfo>,
}

/// Socket + protocol detail for the final connection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub local_addr: Option<String>,
    pub remote_addr: Option<String>,
    pub http_version: String,
}

/// One hop in a redirect chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedirectHop {
    pub status: u16,
    pub url: String,
    pub location: String,
}

/// A single network hop actually performed for a request (each redirect, plus
/// the final request), with its own status and timing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hop {
    pub method: String,
    pub url: String,
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub remote_addr: Option<String>,
    pub timings: Timings,
}

/// Everything we learned about the network path for a request.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub dns: DnsInfo,
    pub tls: Option<TlsInfo>,
    pub connection: Connection,
    pub redirects: Vec<RedirectHop>,
    /// Every hop performed (redirects + final), in order.
    pub hops: Vec<Hop>,
    pub request_size_bytes: u64,
    pub response_size_bytes: u64,
    pub scheme: String,
}

/// A completed HTTP response, returned to the frontend.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<KeyValue>,
    /// Decoded body as UTF-8 (lossy). Empty for pure-binary bodies.
    pub body: String,
    /// Base64 body, set for images / non-UTF-8 payloads (for preview/download).
    pub body_base64: Option<String>,
    pub content_type: Option<String>,
    pub timings: Timings,
    pub network: NetworkInfo,
    pub final_url: String,
    /// Decoded (decompressed) body size in bytes.
    pub body_size_bytes: u64,
    /// Reconstructed raw HTTP request (request line + headers + body).
    #[serde(default)]
    pub raw_request: String,
    /// Reconstructed raw HTTP response head (status line + headers).
    #[serde(default)]
    pub raw_response_head: String,
    /// Base64 of the encrypted bytes we WROTE to the socket (TLS records:
    /// handshake + encrypted request). Capped; empty for non-TLS or reused conns.
    #[serde(default)]
    pub tls_tx_b64: String,
    /// Base64 of the encrypted bytes we READ from the socket (TLS records:
    /// handshake + encrypted response). Capped; empty for non-TLS or reused conns.
    #[serde(default)]
    pub tls_rx_b64: String,
    /// Total bytes written to the socket (may exceed the captured sample).
    #[serde(default)]
    pub tls_tx_total: u64,
    /// Total bytes read from the socket (may exceed the captured sample).
    #[serde(default)]
    pub tls_rx_total: u64,
    /// Base64 of the decrypted HTTP/2 frames SENT (preface + frames). Empty
    /// unless HTTP/2 was negotiated on a fresh connection. Capped.
    #[serde(default)]
    pub h2_tx_b64: String,
    /// Base64 of the decrypted HTTP/2 frames RECEIVED. Capped.
    #[serde(default)]
    pub h2_rx_b64: String,
    #[serde(default)]
    pub h2_tx_total: u64,
    #[serde(default)]
    pub h2_rx_total: u64,
}

/// A saved/named request stored in a collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRequest {
    pub id: String,
    pub name: String,
    pub request: HttpRequest,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A node in a collection tree: either a folder (with children) or a request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    pub id: String,
    pub name: String,
    /// "folder" | "request"
    pub kind: String,
    /// Present when `kind == "request"`.
    #[serde(default)]
    pub request: Option<HttpRequest>,
    /// Present when `kind == "folder"`.
    #[serde(default)]
    pub children: Vec<CollectionItem>,
}

/// A named collection: a tree of folders and saved requests (Postman-style).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub items: Vec<CollectionItem>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A named environment: a set of `{{variable}}` substitutions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedEnvironment {
    pub id: String,
    pub name: String,
    pub variables: Vec<KeyValue>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A lightweight record of a sent request, for the History list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub request: HttpRequest,
    pub status: Option<u16>,
    pub total_ms: f64,
    pub ok: bool,
    pub created_at: i64,
}
