//! End-to-end probe of the instrumented networking core (no UI).
//!
//! Usage: cargo run --example probe -- https://httpbin.org/get

use pulse_lib::model::{Auth, Body, HttpRequest};
use pulse_lib::net;

#[tokio::main]
async fn main() {
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "https://httpbin.org/get".to_string());
    let timeout_ms = std::env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(30_000);

    let req = HttpRequest {
        method: "GET".into(),
        url,
        query_params: vec![],
        headers: vec![],
        body: Body::default(),
        auth: Auth::default(),
        follow_redirects: true,
        timeout_ms,
        verify_tls: true,
        pre_request_script: String::new(),
        post_response_script: String::new(),
    };

    match net::execute(req).await {
        Ok(res) => {
            println!("STATUS : {} {}", res.status, res.status_text);
            println!("HTTP   : {}", res.network.connection.http_version);
            println!(
                "DNS    : resolver={:?} ips={:?} used={:?} ttl={:?} lookup={:.1}ms",
                res.network.dns.resolver,
                res.network.dns.addresses,
                res.network.dns.used_address,
                res.network.dns.ttl,
                res.network.dns.lookup_ms
            );
            if let Some(tls) = &res.network.tls {
                println!(
                    "TLS    : {} | {} | alpn={:?} | certs={}",
                    tls.version,
                    tls.cipher_suite,
                    tls.alpn,
                    tls.certificates.len()
                );
                if let Some(c) = tls.certificates.first() {
                    println!("  cert0: subject={}", c.subject);
                    println!("  cert0: issuer ={}", c.issuer);
                    println!("  cert0: valid  ={} .. {}", c.not_before, c.not_after);
                    println!("  cert0: sha256 ={}", c.fingerprint_sha256);
                }
            }
            println!(
                "TIMING : dns={:.1} tcp={:.1} tls={:.1} ttfb={:.1} dl={:.1} total={:.1} ms",
                res.timings.dns_ms,
                res.timings.tcp_ms,
                res.timings.tls_ms,
                res.timings.ttfb_ms,
                res.timings.download_ms,
                res.timings.total_ms
            );
            println!(
                "SIZE   : wire={}B decoded={}B content-type={:?}",
                res.network.response_size_bytes, res.body_size_bytes, res.content_type
            );
            if !res.network.redirects.is_empty() {
                println!("REDIR  : {} hop(s)", res.network.redirects.len());
                for r in &res.network.redirects {
                    println!("  {} {} -> {}", r.status, r.url, r.location);
                }
            }
            println!("HOPS   : {}", res.network.hops.len());
            for (i, h) in res.network.hops.iter().enumerate() {
                println!(
                    "  {}. {} {} {} ({:.0} ms)",
                    i + 1,
                    h.method,
                    h.status,
                    h.url,
                    h.timings.total_ms
                );
            }
            let preview: String = res.body.chars().take(240).collect();
            println!("BODY   : {}", preview.replace('\n', " "));
        }
        Err(e) => {
            eprintln!("ERROR  : {e}");
            std::process::exit(1);
        }
    }
}
