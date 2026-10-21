//! The instrumented HTTP client.
//!
//! Rather than a high-level client, we drive the request phase-by-phase so we
//! can timestamp DNS → TCP → TLS → TTFB → download individually and capture the
//! resolver, certificate chain, cipher and negotiated protocol along the way.

use crate::model::*;
use crate::net::{dns, tls};
use anyhow::{anyhow, bail, Context};
use base64::Engine;
use bytes::Bytes;
use http::{Method, Version};
use http_body_util::{BodyExt, Full};
use hyper::Request;
use hyper_util::rt::{TokioExecutor, TokioIo};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::task::{Context as TaskContext, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use url::Url;

/// Max encrypted bytes captured per direction for the raw-wire "Encrypted" view.
const TLS_TAP_CAP: usize = 16 * 1024;
/// Max decrypted HTTP/2 frame bytes captured per direction for the frame view.
const H2_TAP_CAP: usize = 32 * 1024;

const MAX_REDIRECTS: usize = 10;
/// Cap base64-encoded binary bodies so we don't ship enormous payloads to the UI.
const BASE64_CAP: usize = 8 * 1024 * 1024;

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// Public entry point used by the Tauri command. Errors become display strings.
/// The WHOLE request (all redirect hops: DNS, TLS, request, and body) is bounded
/// by `timeout_ms` so a slow or dead peer can never hang the request forever.
pub async fn execute(req: HttpRequest) -> Result<HttpResponse, String> {
    let timeout = Duration::from_millis(req.timeout_ms.max(1));
    match tokio::time::timeout(timeout, execute_inner(req)).await {
        Ok(result) => result.map_err(|e| format!("{e:#}")),
        Err(_) => Err(format!("request timed out after {} ms", timeout.as_millis())),
    }
}

/// Result of a single request to a single URL (one hop).
struct SingleResult {
    status: u16,
    status_text: String,
    headers: Vec<KeyValue>,
    raw_body: Bytes,
    content_encoding: Option<String>,
    content_type: Option<String>,
    location: Option<String>,
    timings: Timings,
    network: NetworkInfo,
    raw_request: String,
    raw_response_head: String,
    tls_tx_b64: String,
    tls_rx_b64: String,
    tls_tx_total: u64,
    tls_rx_total: u64,
    h2_tx_b64: String,
    h2_rx_b64: String,
    h2_tx_total: u64,
    h2_rx_total: u64,
}

async fn execute_inner(req: HttpRequest) -> anyhow::Result<HttpResponse> {
    let overall = Instant::now();

    let mut url = build_url(&req)?;
    let mut method = req.method.trim().to_uppercase();
    if method.is_empty() {
        method = "GET".into();
    }

    let prepared = prepare_request(&req)?;
    let mut headers = prepared.headers;
    let mut body = prepared.body;

    let mut redirects: Vec<RedirectHop> = Vec::new();
    let mut hop_list: Vec<Hop> = Vec::new();
    let mut hops = 0usize;

    loop {
        let mut single = perform_single(&url, &method, &headers, body.clone(), &req).await?;

        // Record this hop (every redirect + the final request).
        hop_list.push(Hop {
            method: method.clone(),
            url: url.to_string(),
            status: single.status,
            status_text: single.status_text.clone(),
            http_version: single.network.connection.http_version.clone(),
            remote_addr: single.network.connection.remote_addr.clone(),
            timings: Timings {
                total_ms: single.timings.dns_ms
                    + single.timings.tcp_ms
                    + single.timings.tls_ms
                    + single.timings.ttfb_ms
                    + single.timings.download_ms,
                ..single.timings.clone()
            },
        });

        let is_redirect = matches!(single.status, 301 | 302 | 303 | 307 | 308);
        if req.follow_redirects && is_redirect && hops < MAX_REDIRECTS {
            if let Some(loc) = single.location.clone() {
                let next = url.join(&loc).unwrap_or_else(|_| url.clone());
                redirects.push(RedirectHop {
                    status: single.status,
                    url: url.to_string(),
                    location: next.to_string(),
                });
                // Redirect method/body semantics.
                match single.status {
                    303 => {
                        if method != "HEAD" {
                            method = "GET".into();
                        }
                        body = Bytes::new();
                        strip_body_headers(&mut headers);
                    }
                    301 | 302 => {
                        if method == "POST" {
                            method = "GET".into();
                            body = Bytes::new();
                            strip_body_headers(&mut headers);
                        }
                    }
                    _ => { /* 307 / 308 preserve method + body */ }
                }
                // Never forward credentials to a different origin (prevents
                // leaking Authorization / Cookie / API-key to an attacker host
                // that a redirect points to).
                if !same_origin(&url, &next) {
                    strip_sensitive_headers(&mut headers, &req.auth);
                }
                url = next;
                hops += 1;
                continue;
            }
        }

        // Finalize the last hop into the response.
        single.timings.total_ms = ms(overall.elapsed());
        single.network.redirects = redirects;
        single.network.hops = hop_list;

        let decoded = decompress(&single.raw_body, single.content_encoding.as_deref());
        let body_size_bytes = decoded.len() as u64;
        let is_image = single
            .content_type
            .as_deref()
            .map(|c| c.starts_with("image/"))
            .unwrap_or(false);
        let is_utf8 = std::str::from_utf8(&decoded).is_ok();
        let body_text = if is_utf8 {
            String::from_utf8_lossy(&decoded).to_string()
        } else {
            String::new()
        };
        let body_base64 = if (is_image || !is_utf8) && decoded.len() <= BASE64_CAP {
            Some(base64::engine::general_purpose::STANDARD.encode(&decoded))
        } else {
            None
        };

        return Ok(HttpResponse {
            status: single.status,
            status_text: single.status_text,
            headers: single.headers,
            body: body_text,
            body_base64,
            content_type: single.content_type,
            timings: single.timings,
            network: single.network,
            final_url: url.to_string(),
            body_size_bytes,
            raw_request: single.raw_request,
            raw_response_head: single.raw_response_head,
            tls_tx_b64: single.tls_tx_b64,
            tls_rx_b64: single.tls_rx_b64,
            tls_tx_total: single.tls_tx_total,
            tls_rx_total: single.tls_rx_total,
            h2_tx_b64: single.h2_tx_b64,
            h2_rx_b64: single.h2_rx_b64,
            h2_tx_total: single.h2_tx_total,
            h2_rx_total: single.h2_rx_total,
        });
    }
}

async fn perform_single(
    url: &Url,
    method: &str,
    headers: &[(String, String)],
    body: Bytes,
    req: &HttpRequest,
) -> anyhow::Result<SingleResult> {
    let scheme = url.scheme().to_string();
    if scheme != "http" && scheme != "https" {
        bail!("unsupported URL scheme: {scheme}");
    }
    let is_tls = scheme == "https";
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("URL has no host"))?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow!("cannot determine port"))?;
    let timeout = Duration::from_millis(req.timeout_ms.max(1));
    let proxy = req.proxy_url.trim().to_string();
    let want_reuse = req.reuse_connection;

    let request_size_bytes = estimate_request_size(url, method, headers, body.len());
    let req_body = body.clone();

    // --- Fast path: reuse a live, pooled keep-alive connection -------------
    if want_reuse {
        let key = pool_key(&scheme, &host, port, req);
        if let Some(mut pooled) = pool_take(&key).await {
            // Probe liveness first; only commit to the pooled socket if it is
            // ready (so a server-closed idle connection falls through to a
            // fresh connect WITHOUT risking a double-send).
            if ready_sender(&mut pooled.sender).await {
                let use_h2 = pooled.sender.is_h2();
                let hyper_req = build_hyper_request(url, method, headers, body.clone(), use_h2)?;
                let (parts, resp_body, ttfb, dl) =
                    send_on_sender(&mut pooled.sender, hyper_req).await?;
                let http_version = pooled.connection.http_version.clone();
                let raw_request = build_raw_request(url, method, headers, &req_body, &http_version);
                let raw_response_head = build_raw_response_head(&http_version, &parts);
                let mut dns = pooled.dns.clone();
                dns.lookup_ms = 0.0; // reused: no DNS/TCP/TLS this time
                let timings = Timings {
                    dns_ms: 0.0,
                    tcp_ms: 0.0,
                    tls_ms: 0.0,
                    ttfb_ms: ttfb,
                    download_ms: dl,
                    total_ms: 0.0,
                };
                let result = finalize_single(
                    parts,
                    resp_body,
                    timings,
                    dns,
                    pooled.tls_info.clone(),
                    pooled.connection.clone(),
                    request_size_bytes,
                    scheme.clone(),
                    raw_request,
                    raw_response_head,
                );
                pool_put(key, pooled).await;
                return Ok(result);
            }
            // Not ready → stale connection; drop it and connect fresh below.
        }
    }

    // --- DNS ---------------------------------------------------------------
    let mut dns_result = dns::resolve(&host).await.context("DNS resolution failed")?;
    let dns_ms = if dns_result.info.was_ip_literal {
        0.0
    } else {
        dns_result.info.lookup_ms
    };
    if dns_result.addresses.is_empty() {
        bail!("no IP addresses found for host {host}");
    }

    // --- TCP (direct, or through an HTTP proxy CONNECT tunnel) -------------
    let tcp_start = Instant::now();
    let (tcp, used_label) = if proxy.is_empty() {
        let (tcp, used_ip) = connect_any(&dns_result.addresses, port, timeout).await?;
        (tcp, used_ip.to_string())
    } else {
        let (tcp, proxy_label) = proxy_connect(&proxy, &host, port, timeout).await?;
        (tcp, format!("{proxy_label} (proxy)"))
    };
    let tcp_ms = ms(tcp_start.elapsed());
    let _ = tcp.set_nodelay(true);
    dns_result.info.used_address = Some(used_label);
    let local_addr = tcp.local_addr().ok().map(|a| a.to_string());
    let remote_addr = tcp.peer_addr().ok().map(|a| a.to_string());

    // --- TLS + HTTP handshake ----------------------------------------------
    let mut tap: Option<(Tap, Tap)> = None;
    let mut h2_tap: Option<(Tap, Tap)> = None;
    let (parts, resp_body, ttfb_ms, download_ms, tls_info, tls_ms, http_version, sender) = if is_tls
    {
        // Tap the TCP socket underneath TLS so we capture the ciphertext.
        let tx: Tap = Arc::new(std::sync::Mutex::new(TapBuf::new(TLS_TAP_CAP)));
        let rx: Tap = Arc::new(std::sync::Mutex::new(TapBuf::new(TLS_TAP_CAP)));
        let tapped = TappedStream {
            inner: tcp,
            tx: tx.clone(),
            rx: rx.clone(),
        };
        let tls_start = Instant::now();
        let (tls_stream, tls_info, is_h2) = tls::handshake(
            tapped,
            &host,
            req.verify_tls,
            &req.client_cert_pem,
            &req.client_key_pem,
        )
        .await
        .context("TLS handshake failed")?;
        let tls_ms = ms(tls_start.elapsed());
        // Drop the handshake records — from here the tap holds only the
        // application data encrypted under the negotiated cipher suite.
        if let Ok(mut g) = tx.lock() {
            g.clear();
        }
        if let Ok(mut g) = rx.lock() {
            g.clear();
        }
        tap = Some((tx, rx));
        // For HTTP/2, add a second tap ABOVE TLS to capture the decrypted h2
        // frames (connection preface + frames). HTTP/1.1 isn't framed, so skip.
        let mut sender = if is_h2 {
            let h2tx: Tap = Arc::new(std::sync::Mutex::new(TapBuf::new(H2_TAP_CAP)));
            let h2rx: Tap = Arc::new(std::sync::Mutex::new(TapBuf::new(H2_TAP_CAP)));
            h2_tap = Some((h2tx.clone(), h2rx.clone()));
            let framed = TappedStream {
                inner: tls_stream,
                tx: h2tx,
                rx: h2rx,
            };
            establish(TokioIo::new(framed), true)
                .await
                .context("HTTP handshake failed")?
        } else {
            establish(TokioIo::new(tls_stream), false)
                .await
                .context("HTTP handshake failed")?
        };
        let hyper_req = build_hyper_request(url, method, headers, body.clone(), is_h2)?;
        let (parts, bytes, ttfb, dl) = send_on_sender(&mut sender, hyper_req).await?;
        let ver = http_version_string(is_h2, &parts.version);
        (parts, bytes, ttfb, dl, Some(tls_info), tls_ms, ver, sender)
    } else {
        let mut sender = establish(TokioIo::new(tcp), false)
            .await
            .context("HTTP handshake failed")?;
        let hyper_req = build_hyper_request(url, method, headers, body.clone(), false)?;
        let (parts, bytes, ttfb, dl) = send_on_sender(&mut sender, hyper_req).await?;
        let ver = http_version_string(false, &parts.version);
        (parts, bytes, ttfb, dl, None, 0.0, ver, sender)
    };

    // --- Raw wire reconstruction ------------------------------------------
    let raw_request = build_raw_request(url, method, headers, &req_body, &http_version);
    let raw_response_head = build_raw_response_head(&http_version, &parts);

    let connection = Connection {
        local_addr,
        remote_addr,
        http_version: http_version.clone(),
    };
    let timings = Timings {
        dns_ms,
        tcp_ms,
        tls_ms,
        ttfb_ms,
        download_ms,
        total_ms: 0.0,
    };
    let dns_info = dns_result.info;

    // Return the fresh connection to the pool for subsequent keep-alive reuse.
    if want_reuse {
        let key = pool_key(&scheme, &host, port, req);
        pool_put(
            key,
            Pooled {
                sender,
                tls_info: tls_info.clone(),
                connection: connection.clone(),
                dns: dns_info.clone(),
            },
        )
        .await;
    }

    let mut result = finalize_single(
        parts,
        resp_body,
        timings,
        dns_info,
        tls_info,
        connection,
        request_size_bytes,
        scheme,
        raw_request,
        raw_response_head,
    );
    if let Some((tx, rx)) = tap {
        let (tx_b64, tx_total) = snapshot_tap(&tx);
        let (rx_b64, rx_total) = snapshot_tap(&rx);
        result.tls_tx_b64 = tx_b64;
        result.tls_rx_b64 = rx_b64;
        result.tls_tx_total = tx_total;
        result.tls_rx_total = rx_total;
    }
    if let Some((tx, rx)) = h2_tap {
        let (tx_b64, tx_total) = snapshot_tap(&tx);
        let (rx_b64, rx_total) = snapshot_tap(&rx);
        result.h2_tx_b64 = tx_b64;
        result.h2_rx_b64 = rx_b64;
        result.h2_tx_total = tx_total;
        result.h2_rx_total = rx_total;
    }
    Ok(result)
}

/// Parse `parts` + body into a `SingleResult`, shared by the fresh and the
/// pooled-reuse code paths.
#[allow(clippy::too_many_arguments)]
fn finalize_single(
    parts: http::response::Parts,
    resp_body: Bytes,
    timings: Timings,
    dns: DnsInfo,
    tls_info: Option<TlsInfo>,
    connection: Connection,
    request_size_bytes: u64,
    scheme: String,
    raw_request: String,
    raw_response_head: String,
) -> SingleResult {
    let mut resp_headers = Vec::new();
    let mut content_type = None;
    let mut content_encoding = None;
    let mut location = None;
    for (name, value) in parts.headers.iter() {
        let k = name.as_str().to_string();
        let v = String::from_utf8_lossy(value.as_bytes()).to_string();
        let lk = k.to_ascii_lowercase();
        if lk == "content-type" && content_type.is_none() {
            content_type = Some(v.clone());
        }
        if lk == "content-encoding" && content_encoding.is_none() {
            content_encoding = Some(v.clone());
        }
        if lk == "location" && location.is_none() {
            location = Some(v.clone());
        }
        resp_headers.push(KeyValue {
            enabled: true,
            key: k,
            value: v,
        });
    }

    let response_size_bytes = resp_body.len() as u64;
    let network = NetworkInfo {
        dns,
        tls: tls_info,
        connection,
        redirects: Vec::new(),
        hops: Vec::new(),
        request_size_bytes,
        response_size_bytes,
        scheme,
    };

    SingleResult {
        status: parts.status.as_u16(),
        status_text: parts.status.canonical_reason().unwrap_or("").to_string(),
        headers: resp_headers,
        raw_body: resp_body,
        content_encoding,
        content_type,
        location,
        timings,
        network,
        raw_request,
        raw_response_head,
        tls_tx_b64: String::new(),
        tls_rx_b64: String::new(),
        tls_tx_total: 0,
        tls_rx_total: 0,
        h2_tx_b64: String::new(),
        h2_rx_b64: String::new(),
        h2_tx_total: 0,
        h2_rx_total: 0,
    }
}

/// Reconstruct a human-readable raw HTTP request (request line + headers + body).
fn build_raw_request(
    url: &Url,
    method: &str,
    headers: &[(String, String)],
    body: &Bytes,
    ver: &str,
) -> String {
    let host = url.host_str().unwrap_or("");
    let authority = match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.to_string(),
    };
    let mut path = url.path().to_string();
    if let Some(q) = url.query() {
        path.push('?');
        path.push_str(q);
    }
    if path.is_empty() {
        path.push('/');
    }
    let mut s = format!("{method} {path} {ver}\r\n");
    s.push_str(&format!("Host: {authority}\r\n"));
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("host") {
            continue;
        }
        s.push_str(k);
        s.push_str(": ");
        s.push_str(v);
        s.push_str("\r\n");
    }
    if !body.is_empty()
        && !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-length"))
    {
        s.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    s.push_str("\r\n");
    match std::str::from_utf8(body) {
        Ok(t) => s.push_str(t),
        Err(_) => s.push_str(&format!("<{} bytes of binary data>", body.len())),
    }
    s
}

/// Reconstruct the raw HTTP response head (status line + headers).
fn build_raw_response_head(ver: &str, parts: &http::response::Parts) -> String {
    let reason = parts.status.canonical_reason().unwrap_or("");
    let mut s = format!("{ver} {} {reason}\r\n", parts.status.as_u16());
    for (name, value) in parts.headers.iter() {
        s.push_str(name.as_str());
        s.push_str(": ");
        s.push_str(&String::from_utf8_lossy(value.as_bytes()));
        s.push_str("\r\n");
    }
    s
}

// ---------------------------------------------------------------------------
// Connection senders + keep-alive pool
// ---------------------------------------------------------------------------

/// An HTTP request sender over an established connection (HTTP/1.1 or HTTP/2).
enum PooledSender {
    H1(hyper::client::conn::http1::SendRequest<Full<Bytes>>),
    H2(hyper::client::conn::http2::SendRequest<Full<Bytes>>),
}

impl PooledSender {
    fn is_h2(&self) -> bool {
        matches!(self, PooledSender::H2(_))
    }
}

/// A pooled, idle keep-alive connection plus the network detail we captured when
/// it was first opened (so reused requests can still report TLS / addressing).
struct Pooled {
    sender: PooledSender,
    tls_info: Option<TlsInfo>,
    connection: Connection,
    dns: DnsInfo,
}

/// Global keep-alive connection pool, keyed by origin + TLS/proxy/cert identity.
static POOL: OnceLock<Mutex<HashMap<String, Pooled>>> = OnceLock::new();

fn pool() -> &'static Mutex<HashMap<String, Pooled>> {
    POOL.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn pool_take(key: &str) -> Option<Pooled> {
    pool().lock().await.remove(key)
}

async fn pool_put(key: String, p: Pooled) {
    pool().lock().await.insert(key, p);
}

/// Pool key: same origin + verify flag + proxy + client-cert identity may share
/// a connection; anything differing must not.
fn pool_key(scheme: &str, host: &str, port: u16, req: &HttpRequest) -> String {
    let cert_tag = if req.client_cert_pem.trim().is_empty() {
        0
    } else {
        cheap_hash(&req.client_cert_pem)
    };
    format!(
        "{scheme}://{host}:{port}|v={}|p={}|c={cert_tag}",
        req.verify_tls,
        req.proxy_url.trim()
    )
}

/// FNV-1a — a cheap, dependency-free hash to tag a client certificate identity.
fn cheap_hash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Is the pooled sender ready to accept a new request (connection still alive)?
async fn ready_sender(sender: &mut PooledSender) -> bool {
    match sender {
        PooledSender::H1(s) => s.ready().await.is_ok(),
        PooledSender::H2(s) => s.ready().await.is_ok(),
    }
}

// ---------------------------------------------------------------------------
// Socket tap — records the raw (encrypted) bytes crossing the TCP socket
// underneath TLS, so the UI can show the ciphertext on the wire.
// ---------------------------------------------------------------------------

/// A capped byte recorder: keeps the first `cap` bytes plus a running total.
struct TapBuf {
    data: Vec<u8>,
    total: u64,
    cap: usize,
}

impl TapBuf {
    fn new(cap: usize) -> Self {
        TapBuf {
            data: Vec::new(),
            total: 0,
            cap,
        }
    }
    fn record(&mut self, bytes: &[u8]) {
        self.total += bytes.len() as u64;
        if self.data.len() < self.cap {
            let take = (self.cap - self.data.len()).min(bytes.len());
            self.data.extend_from_slice(&bytes[..take]);
        }
    }
    fn clear(&mut self) {
        self.data.clear();
        self.total = 0;
    }
}

type Tap = Arc<std::sync::Mutex<TapBuf>>;

fn snapshot_tap(tap: &Tap) -> (String, u64) {
    match tap.lock() {
        Ok(g) => (
            base64::engine::general_purpose::STANDARD.encode(&g.data),
            g.total,
        ),
        Err(_) => (String::new(), 0),
    }
}

/// Wraps an IO and tees every byte written (`tx`) and read (`rx`) into tap
/// buffers. Placed under TLS, so it records the encrypted records on the wire.
struct TappedStream<S> {
    inner: S,
    tx: Tap,
    rx: Tap,
}

impl<S: AsyncRead + Unpin> AsyncRead for TappedStream<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let me = self.get_mut();
        let before = buf.filled().len();
        let r = Pin::new(&mut me.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &r {
            let fresh = &buf.filled()[before..];
            if !fresh.is_empty() {
                if let Ok(mut g) = me.rx.lock() {
                    g.record(fresh);
                }
            }
        }
        r
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for TappedStream<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        data: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let me = self.get_mut();
        let r = Pin::new(&mut me.inner).poll_write(cx, data);
        if let Poll::Ready(Ok(n)) = &r {
            if *n > 0 {
                if let Ok(mut g) = me.tx.lock() {
                    g.record(&data[..*n]);
                }
            }
        }
        r
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<std::io::Result<()>> {
        let me = self.get_mut();
        Pin::new(&mut me.inner).poll_flush(cx)
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<std::io::Result<()>> {
        let me = self.get_mut();
        Pin::new(&mut me.inner).poll_shutdown(cx)
    }
}

/// Perform the HTTP handshake over an already-connected (and possibly
/// TLS-wrapped) IO, returning a reusable request sender. The connection task is
/// spawned and kept alive as long as the sender is held (enabling keep-alive).
async fn establish<IO>(io: IO, use_h2: bool) -> anyhow::Result<PooledSender>
where
    IO: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    if use_h2 {
        let (sender, conn) =
            hyper::client::conn::http2::handshake(TokioExecutor::new(), io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        Ok(PooledSender::H2(sender))
    } else {
        let (sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        Ok(PooledSender::H1(sender))
    }
}

/// Send one request on a sender and read the full response, timing TTFB and
/// download separately.
async fn send_on_sender(
    sender: &mut PooledSender,
    req: Request<Full<Bytes>>,
) -> anyhow::Result<(http::response::Parts, Bytes, f64, f64)> {
    match sender {
        PooledSender::H1(s) => s.ready().await?,
        PooledSender::H2(s) => s.ready().await?,
    }
    let send_start = Instant::now();
    let resp = match sender {
        PooledSender::H1(s) => s.send_request(req).await?,
        PooledSender::H2(s) => s.send_request(req).await?,
    };
    let ttfb = ms(send_start.elapsed());
    let (parts, body) = resp.into_parts();
    let dl_start = Instant::now();
    let bytes = collect_body(body).await?;
    let dl = ms(dl_start.elapsed());
    Ok((parts, bytes, ttfb, dl))
}

// ---------------------------------------------------------------------------
// HTTP proxy (CONNECT tunnelling)
// ---------------------------------------------------------------------------

/// Open a TCP connection to an HTTP proxy and establish a `CONNECT` tunnel to
/// `host:port`. Returns the tunneled stream and a "proxyhost:proxyport" label.
/// (SOCKS is not supported; the one SOCKS crate is blocked by the corporate
/// proxy mirror.) Both HTTP and HTTPS targets are tunnelled via CONNECT.
pub(crate) async fn proxy_connect(
    proxy: &str,
    host: &str,
    port: u16,
    timeout: Duration,
) -> anyhow::Result<(TcpStream, String)> {
    let (phost, pport, pcreds) = parse_proxy(proxy)?;
    let mut stream =
        tokio::time::timeout(timeout, TcpStream::connect((phost.as_str(), pport)))
            .await
            .map_err(|_| anyhow!("proxy connect to {phost}:{pport} timed out"))?
            .with_context(|| format!("connecting to proxy {phost}:{pport}"))?;
    let _ = stream.set_nodelay(true);

    let mut connect = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n");
    if let Some(basic) = pcreds {
        connect.push_str(&format!("Proxy-Authorization: Basic {basic}\r\n"));
    }
    connect.push_str("Proxy-Connection: keep-alive\r\n\r\n");
    stream
        .write_all(connect.as_bytes())
        .await
        .context("sending CONNECT to proxy")?;

    // Read the proxy's response head (until CRLF CRLF).
    let mut buf: Vec<u8> = Vec::with_capacity(256);
    let mut tmp = [0u8; 256];
    loop {
        let n = tokio::time::timeout(timeout, stream.read(&mut tmp))
            .await
            .map_err(|_| anyhow!("proxy CONNECT response timed out"))?
            .context("reading proxy CONNECT response")?;
        if n == 0 {
            bail!("proxy closed the connection during CONNECT");
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 16 * 1024 {
            bail!("proxy CONNECT response head too large");
        }
    }

    let head = String::from_utf8_lossy(&buf);
    let status_line = head.lines().next().unwrap_or("");
    let ok = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .map(|c| (200..300).contains(&c))
        .unwrap_or(false);
    if !ok {
        bail!("proxy refused CONNECT: {}", status_line.trim());
    }
    Ok((stream, format!("{phost}:{pport}")))
}

/// Parse a proxy spec into `(host, port, optional base64("user:pass"))`.
/// Accepts `http://host:port`, `host:port`, or bare `host` (defaults to :8080),
/// with optional `user:pass@` userinfo.
fn parse_proxy(proxy: &str) -> anyhow::Result<(String, u16, Option<String>)> {
    let s = proxy.trim();
    let s = s
        .strip_prefix("http://")
        .or_else(|| s.strip_prefix("https://"))
        .unwrap_or(s);
    let (creds, hostport) = match s.split_once('@') {
        Some((userinfo, rest)) => {
            let enc = base64::engine::general_purpose::STANDARD.encode(userinfo.as_bytes());
            (Some(enc), rest)
        }
        None => (None, s),
    };
    let hostport = hostport.trim_end_matches('/');
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) => (
            h.to_string(),
            p.parse::<u16>()
                .map_err(|_| anyhow!("invalid proxy port: {p}"))?,
        ),
        None => (hostport.to_string(), 8080),
    };
    if host.is_empty() {
        bail!("invalid proxy URL: {proxy}");
    }
    Ok((host, port, creds))
}

/// Read the full response body, tolerating an unclean TLS shutdown (a peer that
/// closes without a `close_notify`). Many real servers/proxies do this; browsers
/// and curl accept the bytes already received rather than erroring, so we do too.
async fn collect_body(mut body: hyper::body::Incoming) -> anyhow::Result<Bytes> {
    let mut data: Vec<u8> = Vec::new();
    loop {
        match body.frame().await {
            Some(Ok(frame)) => {
                if let Ok(chunk) = frame.into_data() {
                    data.extend_from_slice(&chunk);
                }
            }
            Some(Err(e)) => {
                if is_unclean_eof(&e) {
                    break;
                }
                return Err(e.into());
            }
            None => break,
        }
    }
    Ok(Bytes::from(data))
}

/// Does this error represent a peer closing the TLS session without a
/// `close_notify`? We tolerate ONLY that case (extremely common and benign).
///
/// We deliberately do NOT treat a generic `UnexpectedEof` as benign, because
/// hyper also raises it for genuine body truncation (an incomplete
/// Content-Length body or a chunked stream cut mid-frame). Those must surface as
/// errors rather than silently returning a truncated body.
fn is_unclean_eof(err: &hyper::Error) -> bool {
    let mut src: Option<&(dyn std::error::Error + 'static)> = Some(err);
    while let Some(e) = src {
        if e.to_string().contains("close_notify") {
            return true;
        }
        src = e.source();
    }
    false
}

pub(crate) async fn connect_any(
    addrs: &[IpAddr],
    port: u16,
    timeout: Duration,
) -> anyhow::Result<(TcpStream, IpAddr)> {
    let mut last_err = None;
    for ip in addrs {
        let sa = SocketAddr::new(*ip, port);
        match tokio::time::timeout(timeout, TcpStream::connect(sa)).await {
            Ok(Ok(stream)) => return Ok((stream, *ip)),
            Ok(Err(e)) => last_err = Some(anyhow!("connect {sa}: {e}")),
            Err(_) => last_err = Some(anyhow!("connect {sa}: timed out")),
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow!("no addresses to connect to")))
}

fn http_version_string(is_h2: bool, v: &Version) -> String {
    if is_h2 {
        return "HTTP/2".to_string();
    }
    match *v {
        Version::HTTP_09 => "HTTP/0.9",
        Version::HTTP_10 => "HTTP/1.0",
        Version::HTTP_11 => "HTTP/1.1",
        Version::HTTP_2 => "HTTP/2",
        Version::HTTP_3 => "HTTP/3",
        _ => "HTTP",
    }
    .to_string()
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

struct Prepared {
    headers: Vec<(String, String)>,
    body: Bytes,
}

fn prepare_request(req: &HttpRequest) -> anyhow::Result<Prepared> {
    let mut headers: Vec<(String, String)> = Vec::new();
    for h in &req.headers {
        if h.enabled && !h.key.trim().is_empty() {
            headers.push((h.key.clone(), h.value.clone()));
        }
    }

    let (body, default_ct) = build_body(&req.body)?;
    if let Some(ct) = default_ct {
        if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type")) {
            headers.push(("Content-Type".into(), ct));
        }
    }

    // SOAP 1.1 signals the operation via a separate, quoted SOAPAction header.
    if req.body.mode == "soap"
        && req.body.soap_version != "1.2"
        && !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case("soapaction"))
    {
        headers.push((
            "SOAPAction".into(),
            format!("\"{}\"", req.body.soap_action.trim()),
        ));
    }

    apply_auth(&req.auth, &mut headers);
    Ok(Prepared { headers, body })
}

fn build_url(req: &HttpRequest) -> anyhow::Result<Url> {
    let raw = req.url.trim();
    if raw.is_empty() {
        bail!("URL is empty");
    }
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let mut url = Url::parse(&with_scheme).with_context(|| format!("invalid URL: {raw}"))?;
    {
        let mut qp = url.query_pairs_mut();
        for p in &req.query_params {
            if p.enabled && !p.key.is_empty() {
                qp.append_pair(&p.key, &p.value);
            }
        }
        if req.auth.kind == "apikey"
            && req.auth.api_key_in == "query"
            && !req.auth.api_key_name.is_empty()
        {
            qp.append_pair(&req.auth.api_key_name, &req.auth.api_key_value);
        }
    }
    Ok(url)
}

pub(crate) fn build_hyper_request(
    url: &Url,
    method: &str,
    headers: &[(String, String)],
    body: Bytes,
    use_h2: bool,
) -> anyhow::Result<Request<Full<Bytes>>> {
    let method =
        Method::from_bytes(method.as_bytes()).map_err(|_| anyhow!("invalid method: {method}"))?;
    let host = url.host_str().unwrap_or("");
    let authority = match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.to_string(),
    };
    let mut path_and_query = url.path().to_string();
    if let Some(q) = url.query() {
        path_and_query.push('?');
        path_and_query.push_str(q);
    }
    if path_and_query.is_empty() {
        path_and_query.push('/');
    }

    let uri: hyper::Uri = if use_h2 {
        url.as_str().parse().context("parsing absolute URI")?
    } else {
        path_and_query.parse().context("parsing request path")?
    };

    let mut builder = Request::builder().method(method).uri(uri);
    if !use_h2 {
        builder = builder.header(hyper::header::HOST, authority);
    }
    for (k, v) in headers {
        if k.is_empty() {
            continue;
        }
        if !use_h2 && k.eq_ignore_ascii_case("host") {
            continue; // we set Host ourselves for HTTP/1.1
        }
        builder = builder.header(k.as_str(), v.as_str());
    }
    builder
        .body(Full::new(body))
        .context("building request (check header names/values)")
}

fn build_body(body: &Body) -> anyhow::Result<(Bytes, Option<String>)> {
    match body.mode.as_str() {
        "none" | "" => Ok((Bytes::new(), None)),
        "json" => Ok((
            Bytes::from(body.raw.clone().into_bytes()),
            Some("application/json".into()),
        )),
        "text" => Ok((
            Bytes::from(body.raw.clone().into_bytes()),
            Some("text/plain; charset=utf-8".into()),
        )),
        "form" => {
            let encoded = urlencode_form(&body.form);
            Ok((
                Bytes::from(encoded.into_bytes()),
                Some("application/x-www-form-urlencoded".into()),
            ))
        }
        "graphql" => {
            let vars: serde_json::Value = if body.graphql_variables.trim().is_empty() {
                serde_json::json!({})
            } else {
                serde_json::from_str(&body.graphql_variables).unwrap_or(serde_json::json!({}))
            };
            let payload = serde_json::json!({ "query": body.raw, "variables": vars });
            Ok((
                Bytes::from(serde_json::to_vec(&payload)?),
                Some("application/json".into()),
            ))
        }
        "binary" => {
            let path = body.binary_path.trim();
            if path.is_empty() {
                return Ok((Bytes::new(), None));
            }
            let data = std::fs::read(path).with_context(|| format!("reading file {path}"))?;
            Ok((Bytes::from(data), Some(guess_mime(path))))
        }
        "multipart" => {
            let (data, ct) = build_multipart(&body.multipart)?;
            Ok((Bytes::from(data), Some(ct)))
        }
        "soap" => {
            let bytes = Bytes::from(body.soap_envelope.clone().into_bytes());
            // SOAP 1.2 carries the action inside the Content-Type; 1.1 uses a
            // separate SOAPAction header (added in `prepare_request`).
            let ct = if body.soap_version == "1.2" {
                let action = body.soap_action.trim();
                if action.is_empty() {
                    "application/soap+xml; charset=utf-8".to_string()
                } else {
                    format!("application/soap+xml; charset=utf-8; action=\"{action}\"")
                }
            } else {
                "text/xml; charset=utf-8".to_string()
            };
            Ok((bytes, Some(ct)))
        }
        other => bail!("unknown body mode: {other}"),
    }
}

fn urlencode_form(form: &[KeyValue]) -> String {
    let mut ser = url::form_urlencoded::Serializer::new(String::new());
    for kv in form {
        if kv.enabled && !kv.key.is_empty() {
            ser.append_pair(&kv.key, &kv.value);
        }
    }
    ser.finish()
}

fn build_multipart(fields: &[MultipartField]) -> anyhow::Result<(Vec<u8>, String)> {
    let boundary = format!("----PulseBoundary{}", uuid::Uuid::new_v4().simple());
    let mut body = Vec::new();
    for f in fields {
        if !f.enabled || f.key.is_empty() {
            continue;
        }
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        if f.kind == "file" {
            let path = f.value.trim();
            let data = std::fs::read(path).with_context(|| format!("reading file {path}"))?;
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            let ct = guess_mime(path);
            body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
                    f.key, filename
                )
                .as_bytes(),
            );
            body.extend_from_slice(format!("Content-Type: {ct}\r\n\r\n").as_bytes());
            body.extend_from_slice(&data);
            body.extend_from_slice(b"\r\n");
        } else {
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", f.key).as_bytes(),
            );
            body.extend_from_slice(f.value.as_bytes());
            body.extend_from_slice(b"\r\n");
        }
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((body, format!("multipart/form-data; boundary={boundary}")))
}

pub(crate) fn apply_auth(auth: &Auth, headers: &mut Vec<(String, String)>) {
    match auth.kind.as_str() {
        "bearer" => {
            if !auth.token.is_empty() {
                headers.push(("Authorization".into(), format!("Bearer {}", auth.token)));
            }
        }
        "basic" => {
            let raw = format!("{}:{}", auth.username, auth.password);
            let enc = base64::engine::general_purpose::STANDARD.encode(raw.as_bytes());
            headers.push(("Authorization".into(), format!("Basic {enc}")));
        }
        "apikey" => {
            if auth.api_key_in == "header" && !auth.api_key_name.is_empty() {
                headers.push((auth.api_key_name.clone(), auth.api_key_value.clone()));
            }
        }
        _ => {}
    }
}

fn strip_body_headers(headers: &mut Vec<(String, String)>) {
    headers.retain(|(k, _)| {
        !(k.eq_ignore_ascii_case("content-type") || k.eq_ignore_ascii_case("content-length"))
    });
}

/// Same scheme + host + effective port.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Drop credential-bearing headers (used when a redirect crosses origins).
fn strip_sensitive_headers(headers: &mut Vec<(String, String)>, auth: &Auth) {
    let apikey = if auth.kind == "apikey" && auth.api_key_in == "header" {
        Some(auth.api_key_name.to_ascii_lowercase())
    } else {
        None
    };
    headers.retain(|(k, _)| {
        let lk = k.to_ascii_lowercase();
        lk != "authorization"
            && lk != "cookie"
            && lk != "proxy-authorization"
            && apikey.as_deref() != Some(lk.as_str())
    });
}

fn estimate_request_size(url: &Url, method: &str, headers: &[(String, String)], body_len: usize) -> u64 {
    let path_len = url.path().len() + url.query().map(|q| q.len() + 1).unwrap_or(0);
    let request_line = method.len() + 1 + path_len + 11; // " HTTP/1.1\r\n"
    let header_len: usize = headers.iter().map(|(k, v)| k.len() + v.len() + 4).sum();
    (request_line + header_len + 2 + body_len) as u64
}

fn decompress(data: &[u8], encoding: Option<&str>) -> Vec<u8> {
    let enc = encoding.unwrap_or("").to_ascii_lowercase();
    // Content-Encoding may chain multiple codings, e.g. `gzip, br`. They are
    // applied left-to-right on the wire, so decode right-to-left.
    let tokens: Vec<&str> = enc
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && *s != "identity")
        .collect();
    if tokens.is_empty() {
        return data.to_vec();
    }
    let mut current = data.to_vec();
    for token in tokens.iter().rev() {
        current = decode_one(&current, token);
    }
    current
}

fn decode_one(data: &[u8], enc: &str) -> Vec<u8> {
    use std::io::Read;
    let result: std::io::Result<Vec<u8>> = match enc {
        "gzip" | "x-gzip" => {
            let mut d = flate2::read::GzDecoder::new(data);
            let mut out = Vec::new();
            d.read_to_end(&mut out).map(|_| out)
        }
        "deflate" => {
            let mut d = flate2::read::ZlibDecoder::new(data);
            let mut out = Vec::new();
            d.read_to_end(&mut out).map(|_| out)
        }
        "br" => {
            let mut d = brotli::Decompressor::new(data, 4096);
            let mut out = Vec::new();
            d.read_to_end(&mut out).map(|_| out)
        }
        "zstd" => zstd::stream::decode_all(data),
        _ => return data.to_vec(), // unknown coding — leave as-is
    };
    match result {
        Ok(v) => v,
        Err(_) if enc == "deflate" => {
            // Some servers send raw (headerless) deflate — try that.
            let mut d = flate2::read::DeflateDecoder::new(data);
            let mut out = Vec::new();
            if d.read_to_end(&mut out).is_ok() {
                out
            } else {
                data.to_vec()
            }
        }
        Err(_) => data.to_vec(),
    }
}

fn guess_mime(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "json" => "application/json",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    };
    mime.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_gets_https_scheme_when_missing() {
        let mut req = HttpRequest {
            method: "GET".into(),
            url: "example.com/path".into(),
            query_params: vec![],
            headers: vec![],
            body: Body::default(),
            auth: Auth::default(),
            follow_redirects: true,
            timeout_ms: 30000,
            verify_tls: true,
            pre_request_script: String::new(),
            post_response_script: String::new(),
            reuse_connection: false,
            proxy_url: String::new(),
            client_cert_pem: String::new(),
            client_key_pem: String::new(),
        };
        let url = build_url(&req).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("example.com"));

        req.url = "http://example.com".into();
        assert_eq!(build_url(&req).unwrap().scheme(), "http");
    }

    #[test]
    fn query_params_are_appended() {
        let req = HttpRequest {
            method: "GET".into(),
            url: "https://example.com/search".into(),
            query_params: vec![
                KeyValue { enabled: true, key: "q".into(), value: "rust lang".into() },
                KeyValue { enabled: false, key: "skip".into(), value: "1".into() },
            ],
            headers: vec![],
            body: Body::default(),
            auth: Auth::default(),
            follow_redirects: true,
            timeout_ms: 30000,
            verify_tls: true,
            pre_request_script: String::new(),
            post_response_script: String::new(),
            reuse_connection: false,
            proxy_url: String::new(),
            client_cert_pem: String::new(),
            client_key_pem: String::new(),
        };
        let url = build_url(&req).unwrap();
        let q = url.query().unwrap();
        assert!(q.contains("q=rust+lang"));
        assert!(!q.contains("skip"));
    }

    #[test]
    fn basic_auth_header_is_encoded() {
        let mut headers = Vec::new();
        let auth = Auth {
            kind: "basic".into(),
            username: "user".into(),
            password: "pass".into(),
            ..Auth::default()
        };
        apply_auth(&auth, &mut headers);
        // base64("user:pass") == "dXNlcjpwYXNz"
        assert_eq!(
            headers[0],
            ("Authorization".to_string(), "Basic dXNlcjpwYXNz".to_string())
        );
    }

    #[test]
    fn gzip_roundtrip_decompresses() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;
        let mut e = GzEncoder::new(Vec::new(), Compression::default());
        e.write_all(b"hello pulse").unwrap();
        let compressed = e.finish().unwrap();
        let out = decompress(&compressed, Some("gzip"));
        assert_eq!(out, b"hello pulse");
    }

    #[test]
    fn json_body_sets_content_type() {
        let body = Body {
            mode: "json".into(),
            raw: "{\"a\":1}".into(),
            ..Body::default()
        };
        let (bytes, ct) = build_body(&body).unwrap();
        assert_eq!(ct.as_deref(), Some("application/json"));
        assert_eq!(&bytes[..], b"{\"a\":1}");
    }

    #[test]
    fn soap11_sets_textxml_and_soapaction_header() {
        let req = HttpRequest {
            method: "POST".into(),
            url: "https://example.com/svc".into(),
            query_params: vec![],
            headers: vec![],
            body: Body {
                mode: "soap".into(),
                soap_envelope: "<soap:Envelope/>".into(),
                soap_version: "1.1".into(),
                soap_action: "urn:doThing".into(),
                ..Body::default()
            },
            auth: Auth::default(),
            follow_redirects: true,
            timeout_ms: 30000,
            verify_tls: true,
            pre_request_script: String::new(),
            post_response_script: String::new(),
            reuse_connection: false,
            proxy_url: String::new(),
            client_cert_pem: String::new(),
            client_key_pem: String::new(),
        };
        let prepared = prepare_request(&req).unwrap();
        let ct = prepared
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
            .map(|(_, v)| v.clone());
        assert_eq!(ct.as_deref(), Some("text/xml; charset=utf-8"));
        let action = prepared
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("soapaction"))
            .map(|(_, v)| v.clone());
        assert_eq!(action.as_deref(), Some("\"urn:doThing\""));
    }

    #[test]
    fn soap12_folds_action_into_content_type_and_omits_header() {
        let req = HttpRequest {
            method: "POST".into(),
            url: "https://example.com/svc".into(),
            query_params: vec![],
            headers: vec![],
            body: Body {
                mode: "soap".into(),
                soap_envelope: "<soap:Envelope/>".into(),
                soap_version: "1.2".into(),
                soap_action: "urn:doThing".into(),
                ..Body::default()
            },
            auth: Auth::default(),
            follow_redirects: true,
            timeout_ms: 30000,
            verify_tls: true,
            pre_request_script: String::new(),
            post_response_script: String::new(),
            reuse_connection: false,
            proxy_url: String::new(),
            client_cert_pem: String::new(),
            client_key_pem: String::new(),
        };
        let prepared = prepare_request(&req).unwrap();
        let ct = prepared
            .headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
            .map(|(_, v)| v.clone());
        assert_eq!(
            ct.as_deref(),
            Some("application/soap+xml; charset=utf-8; action=\"urn:doThing\"")
        );
        assert!(!prepared
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("soapaction")));
    }
}
