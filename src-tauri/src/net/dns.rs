//! DNS resolution with resolver detail (nameservers, resolved IPs, TTL, timing).
//!
//! Uses `hickory-resolver` so we can surface *which* nameservers the system is
//! configured to use and the TTL of the answer — detail the OS resolver hides.

use crate::model::DnsInfo;
use hickory_resolver::config::{ResolverConfig, ResolverOpts};
use hickory_resolver::TokioAsyncResolver;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Instant;

pub struct DnsResult {
    pub info: DnsInfo,
    pub addresses: Vec<IpAddr>,
}

/// Resolve `host` to one or more IP addresses, capturing resolver detail.
///
/// If `host` is already an IP literal, resolution is skipped.
pub async fn resolve(host: &str) -> anyhow::Result<DnsResult> {
    // Fast-path: the host is already an IP literal — no DNS needed.
    if let Ok(ip) = IpAddr::from_str(host) {
        let info = DnsInfo {
            was_ip_literal: true,
            addresses: vec![ip.to_string()],
            used_address: Some(ip.to_string()),
            ..Default::default()
        };
        return Ok(DnsResult {
            info,
            addresses: vec![ip],
        });
    }

    // Read the system's configured resolvers (/etc/resolv.conf on macOS).
    let (config, opts) = hickory_resolver::system_conf::read_system_conf()
        .unwrap_or_else(|_| (ResolverConfig::default(), ResolverOpts::default()));

    // Collect the configured nameserver addresses (deduped).
    let mut resolver_addrs: Vec<String> = Vec::new();
    for ns in config.name_servers() {
        let addr = ns.socket_addr.ip().to_string();
        if !resolver_addrs.contains(&addr) {
            resolver_addrs.push(addr);
        }
    }

    let resolver = TokioAsyncResolver::tokio(config, opts);

    let start = Instant::now();
    let lookup = resolver.lookup_ip(host).await?;
    let lookup_ms = start.elapsed().as_secs_f64() * 1000.0;

    let addresses: Vec<IpAddr> = lookup.iter().collect();
    let ttl = lookup.as_lookup().record_iter().map(|r| r.ttl()).min();

    let info = DnsInfo {
        resolver: resolver_addrs,
        addresses: addresses.iter().map(|a| a.to_string()).collect(),
        used_address: None, // filled in once we pick an address to connect to
        ttl,
        lookup_ms,
        was_ip_literal: false,
    };

    Ok(DnsResult { info, addresses })
}
