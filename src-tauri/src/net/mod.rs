//! Networking core: an instrumented HTTP client that measures every phase of a
//! request (DNS, TCP, TLS, TTFB, download) and captures resolver, certificate
//! and protocol detail.

pub mod client;
pub mod dns;
pub mod tls;

pub use client::execute;
