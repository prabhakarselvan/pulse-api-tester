//! A reusable, instrumented stream connector shared by the realtime clients
//! (WebSocket + SSE). It performs the same DNS → TCP → (proxy CONNECT) → TLS
//! dance as the HTTP client and reports per-phase timings, so a WebSocket or an
//! SSE stream shows the same deep network detail as a plain request.

use crate::model::{Connection, DnsInfo, HttpRequest, TlsInfo};
use crate::net::{client, dns, tls};
use anyhow::{anyhow, bail, Context};
use std::io;
use std::pin::Pin;
use std::task::{Context as TaskContext, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use url::Url;

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// A connected stream that is either plaintext TCP or TLS-wrapped.
pub enum MaybeTls {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

impl AsyncRead for MaybeTls {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            MaybeTls::Plain(s) => Pin::new(s).poll_read(cx, buf),
            MaybeTls::Tls(s) => Pin::new(&mut **s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for MaybeTls {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            MaybeTls::Plain(s) => Pin::new(s).poll_write(cx, buf),
            MaybeTls::Tls(s) => Pin::new(&mut **s).poll_write(cx, buf),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            MaybeTls::Plain(s) => Pin::new(s).poll_flush(cx),
            MaybeTls::Tls(s) => Pin::new(&mut **s).poll_flush(cx),
        }
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            MaybeTls::Plain(s) => Pin::new(s).poll_shutdown(cx),
            MaybeTls::Tls(s) => Pin::new(&mut **s).poll_shutdown(cx),
        }
    }
}

/// A connected stream plus the network detail captured while establishing it.
pub struct StreamConn {
    pub stream: MaybeTls,
    pub dns: DnsInfo,
    pub tls: Option<TlsInfo>,
    pub connection: Connection,
    pub dns_ms: f64,
    pub tcp_ms: f64,
    pub tls_ms: f64,
}

/// Default port for a scheme when the URL omits one.
fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "https" | "wss" => Some(443),
        "http" | "ws" => Some(80),
        _ => None,
    }
}

/// Connect to `url`, measuring DNS/TCP/TLS, honouring the request's proxy, TLS
/// verification and client-certificate settings.
pub async fn connect_stream(url: &Url, is_tls: bool, req: &HttpRequest) -> anyhow::Result<StreamConn> {
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("URL has no host"))?
        .to_string();
    let port = url
        .port()
        .or_else(|| default_port(url.scheme()))
        .ok_or_else(|| anyhow!("cannot determine port"))?;
    // The configured timeout bounds the connect phase (the stream itself is long-lived).
    let timeout = Duration::from_millis(req.timeout_ms.max(1));

    // --- DNS ---
    let mut dns_result = dns::resolve(&host).await.context("DNS resolution failed")?;
    let dns_ms = if dns_result.info.was_ip_literal {
        0.0
    } else {
        dns_result.info.lookup_ms
    };
    if dns_result.addresses.is_empty() {
        bail!("no IP addresses found for host {host}");
    }

    // --- TCP (direct or via proxy CONNECT) ---
    let proxy = req.proxy_url.trim();
    let tcp_start = Instant::now();
    let (tcp, used_label) = if proxy.is_empty() {
        let (tcp, used_ip) = client::connect_any(&dns_result.addresses, port, timeout).await?;
        (tcp, used_ip.to_string())
    } else {
        let (tcp, label) = client::proxy_connect(proxy, &host, port, timeout).await?;
        (tcp, format!("{label} (proxy)"))
    };
    let tcp_ms = ms(tcp_start.elapsed());
    let _ = tcp.set_nodelay(true);
    dns_result.info.used_address = Some(used_label);
    let local_addr = tcp.local_addr().ok().map(|a| a.to_string());
    let remote_addr = tcp.peer_addr().ok().map(|a| a.to_string());

    // --- TLS ---
    let (stream, tls_info, tls_ms) = if is_tls {
        let tls_start = Instant::now();
        let (tls_stream, tls_info, _is_h2) = tls::handshake(
            tcp,
            &host,
            req.verify_tls,
            &req.client_cert_pem,
            &req.client_key_pem,
        )
        .await
        .context("TLS handshake failed")?;
        (
            MaybeTls::Tls(Box::new(tls_stream)),
            Some(tls_info),
            ms(tls_start.elapsed()),
        )
    } else {
        (MaybeTls::Plain(tcp), None, 0.0)
    };

    Ok(StreamConn {
        stream,
        dns: dns_result.info,
        tls: tls_info,
        connection: Connection {
            local_addr,
            remote_addr,
            http_version: String::new(),
        },
        dns_ms,
        tcp_ms,
        tls_ms,
    })
}
