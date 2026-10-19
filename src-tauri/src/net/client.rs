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
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use url::Url;

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

    // --- TCP ---------------------------------------------------------------
    let tcp_start = Instant::now();
    let (tcp, used_ip) = connect_any(&dns_result.addresses, port, timeout).await?;
    let tcp_ms = ms(tcp_start.elapsed());
    let _ = tcp.set_nodelay(true);
    dns_result.info.used_address = Some(used_ip.to_string());
    let local_addr = tcp.local_addr().ok().map(|a| a.to_string());
    let remote_addr = tcp.peer_addr().ok().map(|a| a.to_string());

    let request_size_bytes = estimate_request_size(url, method, headers, body.len());

    // --- TLS + HTTP --------------------------------------------------------
    let (parts, resp_body, ttfb_ms, download_ms, tls_info, tls_ms, http_version) = if is_tls {
        let tls_start = Instant::now();
        let (tls_stream, tls_info, is_h2) = tls::handshake(tcp, &host, req.verify_tls)
            .await
            .context("TLS handshake failed")?;
        let tls_ms = ms(tls_start.elapsed());
        let hyper_req = build_hyper_request(url, method, headers, body, is_h2)?;
        let (parts, bytes, ttfb, dl) = drive_http(TokioIo::new(tls_stream), hyper_req, is_h2).await?;
        let ver = http_version_string(is_h2, &parts.version);
        (parts, bytes, ttfb, dl, Some(tls_info), tls_ms, ver)
    } else {
        let hyper_req = build_hyper_request(url, method, headers, body, false)?;
        let (parts, bytes, ttfb, dl) = drive_http(TokioIo::new(tcp), hyper_req, false).await?;
        let ver = http_version_string(false, &parts.version);
        (parts, bytes, ttfb, dl, None, 0.0, ver)
    };

    // --- Parse response headers -------------------------------------------
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
    let timings = Timings {
        dns_ms,
        tcp_ms,
        tls_ms,
        ttfb_ms,
        download_ms,
        total_ms: 0.0,
    };
    let network = NetworkInfo {
        dns: dns_result.info,
        tls: tls_info,
        connection: Connection {
            local_addr,
            remote_addr,
            http_version,
        },
        redirects: Vec::new(),
        hops: Vec::new(),
        request_size_bytes,
        response_size_bytes,
        scheme,
    };

    Ok(SingleResult {
        status: parts.status.as_u16(),
        status_text: parts
            .status
            .canonical_reason()
            .unwrap_or("")
            .to_string(),
        headers: resp_headers,
        raw_body: resp_body,
        content_encoding,
        content_type,
        location,
        timings,
        network,
    })
}

/// Drive the HTTP exchange over an already-connected (and possibly TLS-wrapped)
/// IO, returning response parts, body bytes, TTFB and download time.
async fn drive_http<IO>(
    io: IO,
    req: Request<Full<Bytes>>,
    use_h2: bool,
) -> anyhow::Result<(http::response::Parts, Bytes, f64, f64)>
where
    IO: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
{
    if use_h2 {
        let (mut sender, conn) =
            hyper::client::conn::http2::handshake(TokioExecutor::new(), io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        sender.ready().await?;
        let send_start = Instant::now();
        let resp = sender.send_request(req).await?;
        let ttfb = ms(send_start.elapsed());
        let (parts, body) = resp.into_parts();
        let dl_start = Instant::now();
        let bytes = collect_body(body).await?;
        let dl = ms(dl_start.elapsed());
        Ok((parts, bytes, ttfb, dl))
    } else {
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        sender.ready().await?;
        let send_start = Instant::now();
        let resp = sender.send_request(req).await?;
        let ttfb = ms(send_start.elapsed());
        let (parts, body) = resp.into_parts();
        let dl_start = Instant::now();
        let bytes = collect_body(body).await?;
        let dl = ms(dl_start.elapsed());
        Ok((parts, bytes, ttfb, dl))
    }
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

async fn connect_any(
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

fn build_hyper_request(
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

fn apply_auth(auth: &Auth, headers: &mut Vec<(String, String)>) {
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
}
