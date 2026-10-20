//! TLS handshake + introspection.
//!
//! Performs the rustls handshake over an established TCP stream and extracts the
//! negotiated version, cipher suite, ALPN protocol, and the full peer
//! certificate chain (parsed with `x509-parser`).

use crate::model::{CertInfo, TlsInfo};
use anyhow::Context;
use base64::Engine;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use rustls_pki_types::{
    CertificateDer, PrivateKeyDer, PrivatePkcs1KeyDer, PrivatePkcs8KeyDer, PrivateSec1KeyDer,
    ServerName, UnixTime,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::TlsConnector;

/// A parsed client-certificate chain + private key for mutual TLS.
type ClientAuth = (Vec<CertificateDer<'static>>, PrivateKeyDer<'static>);

/// Build a rustls client config. When `verify` is false, certificate
/// verification is disabled (useful for self-signed / staging servers).
/// `client_auth`, when set, presents a client certificate for mutual TLS.
fn make_config(verify: bool, client_auth: Option<ClientAuth>) -> anyhow::Result<Arc<ClientConfig>> {
    let provider = rustls::crypto::ring::default_provider();

    let builder = if verify {
        let mut roots = RootCertStore::empty();
        // Mozilla's bundled roots — always present.
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        // System/corporate roots from the macOS keychain — best effort.
        let native = rustls_native_certs::load_native_certs();
        for cert in native.certs {
            let _ = roots.add(cert);
        }
        ClientConfig::builder_with_provider(Arc::new(provider))
            .with_safe_default_protocol_versions()
            .expect("default TLS versions are valid")
            .with_root_certificates(roots)
    } else {
        let algs = provider.signature_verification_algorithms;
        ClientConfig::builder_with_provider(Arc::new(provider))
            .with_safe_default_protocol_versions()
            .expect("default TLS versions are valid")
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoVerifier(algs)))
    };

    let mut config = match client_auth {
        Some((certs, key)) => builder
            .with_client_auth_cert(certs, key)
            .context("invalid client certificate or private key")?,
        None => builder.with_no_client_auth(),
    };

    // Offer HTTP/2 then HTTP/1.1 via ALPN.
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

/// Perform the TLS handshake and extract connection detail.
/// Returns the stream, the parsed `TlsInfo`, and whether HTTP/2 was negotiated.
pub async fn handshake(
    tcp: TcpStream,
    host: &str,
    verify: bool,
    client_cert_pem: &str,
    client_key_pem: &str,
) -> anyhow::Result<(TlsStream<TcpStream>, TlsInfo, bool)> {
    let client_auth = parse_client_auth(client_cert_pem, client_key_pem)?;
    let connector = TlsConnector::from(make_config(verify, client_auth)?);
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|_| anyhow::anyhow!("invalid server name for TLS: {host}"))?;

    let tls = connector
        .connect(server_name, tcp)
        .await
        .context("TLS handshake failed")?;

    let (_io, conn) = tls.get_ref();
    let version = conn
        .protocol_version()
        .map(|v| pretty_version(&format!("{v:?}")))
        .unwrap_or_default();
    let cipher_suite = conn
        .negotiated_cipher_suite()
        .map(|c| format!("{:?}", c.suite()))
        .unwrap_or_default();
    let alpn = conn
        .alpn_protocol()
        .map(|p| String::from_utf8_lossy(p).to_string());
    let is_h2 = alpn.as_deref() == Some("h2");
    let certificates = conn
        .peer_certificates()
        .map(|chain| chain.iter().map(parse_cert).collect())
        .unwrap_or_default();

    let info = TlsInfo {
        version,
        cipher_suite,
        alpn,
        certificates,
    };
    Ok((tls, info, is_h2))
}

/// Parse a client certificate chain + private key from PEM text for mutual TLS.
/// Returns `Ok(None)` when neither is supplied. Both must be present together.
fn parse_client_auth(cert_pem: &str, key_pem: &str) -> anyhow::Result<Option<ClientAuth>> {
    let has_cert = !cert_pem.trim().is_empty();
    let has_key = !key_pem.trim().is_empty();
    if !has_cert && !has_key {
        return Ok(None);
    }
    if has_cert != has_key {
        anyhow::bail!("mutual TLS requires BOTH a client certificate and a private key");
    }

    let certs: Vec<CertificateDer<'static>> = pem_blocks(cert_pem)
        .into_iter()
        .filter(|(label, _)| label == "CERTIFICATE")
        .map(|(_, der)| CertificateDer::from(der))
        .collect();
    if certs.is_empty() {
        anyhow::bail!("no CERTIFICATE block found in the client certificate PEM");
    }

    let key = pem_blocks(key_pem)
        .into_iter()
        .find_map(|(label, der)| match label.as_str() {
            "PRIVATE KEY" => Some(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(der))),
            "RSA PRIVATE KEY" => Some(PrivateKeyDer::Pkcs1(PrivatePkcs1KeyDer::from(der))),
            "EC PRIVATE KEY" => Some(PrivateKeyDer::Sec1(PrivateSec1KeyDer::from(der))),
            _ => None,
        })
        .ok_or_else(|| {
            anyhow::anyhow!("no PRIVATE KEY block (PKCS#8/PKCS#1/SEC1) found in the client key PEM")
        })?;

    Ok(Some((certs, key)))
}

/// Split PEM text into `(label, DER bytes)` pairs, e.g. ("CERTIFICATE", <der>).
fn pem_blocks(pem: &str) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let mut lines = pem.lines();
    while let Some(line) = lines.next() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("-----BEGIN ") {
            let label = rest.trim_end_matches('-').trim().to_string();
            let mut b64 = String::new();
            for l in lines.by_ref() {
                let l = l.trim();
                if l.starts_with("-----END ") {
                    break;
                }
                b64.push_str(l);
            }
            if let Ok(der) = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()) {
                out.push((label, der));
            }
        }
    }
    out
}

/// "TLSv1_3" -> "TLS 1.3"
fn pretty_version(raw: &str) -> String {
    match raw {
        "TLSv1_3" => "TLS 1.3".to_string(),
        "TLSv1_2" => "TLS 1.2".to_string(),
        "TLSv1_1" => "TLS 1.1".to_string(),
        "TLSv1_0" => "TLS 1.0".to_string(),
        other => other.to_string(),
    }
}

/// Parse a single DER certificate into display-friendly detail. Best-effort:
/// even if ASN.1 parsing fails, the SHA-256 fingerprint is still returned.
fn parse_cert(der: &CertificateDer) -> CertInfo {
    let fingerprint = fingerprint_sha256(der.as_ref());

    match x509_parser::parse_x509_certificate(der.as_ref()) {
        Ok((_, cert)) => {
            let san = cert
                .subject_alternative_name()
                .ok()
                .flatten()
                .map(|ext| {
                    ext.value
                        .general_names
                        .iter()
                        .map(|gn| match gn {
                            x509_parser::extensions::GeneralName::DNSName(s) => s.to_string(),
                            x509_parser::extensions::GeneralName::IPAddress(ip) => format_ip(ip),
                            x509_parser::extensions::GeneralName::RFC822Name(s) => s.to_string(),
                            other => format!("{other:?}"),
                        })
                        .collect()
                })
                .unwrap_or_default();

            let is_ca = cert
                .basic_constraints()
                .ok()
                .flatten()
                .map(|bc| bc.value.ca)
                .unwrap_or(false);

            CertInfo {
                subject: cert.subject().to_string(),
                issuer: cert.issuer().to_string(),
                not_before: cert.validity().not_before.to_string(),
                not_after: cert.validity().not_after.to_string(),
                not_before_ts: Some(cert.validity().not_before.timestamp()),
                not_after_ts: Some(cert.validity().not_after.timestamp()),
                san,
                serial: cert.raw_serial_as_string(),
                signature_algorithm: sig_alg_name(
                    &cert.signature_algorithm.algorithm.to_id_string(),
                ),
                fingerprint_sha256: fingerprint,
                is_ca,
            }
        }
        Err(_) => CertInfo {
            subject: "<unparseable certificate>".to_string(),
            fingerprint_sha256: fingerprint,
            ..Default::default()
        },
    }
}

fn fingerprint_sha256(der: &[u8]) -> String {
    Sha256::digest(der)
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn format_ip(bytes: &[u8]) -> String {
    match bytes.len() {
        4 => format!("{}.{}.{}.{}", bytes[0], bytes[1], bytes[2], bytes[3]),
        16 => bytes
            .chunks(2)
            .map(|c| format!("{:02x}{:02x}", c[0], c[1]))
            .collect::<Vec<_>>()
            .join(":"),
        _ => "<ip>".to_string(),
    }
}

/// Map common signature-algorithm OIDs to human names, falling back to the OID.
fn sig_alg_name(oid: &str) -> String {
    let name = match oid {
        "1.2.840.113549.1.1.11" => "SHA256-RSA",
        "1.2.840.113549.1.1.12" => "SHA384-RSA",
        "1.2.840.113549.1.1.13" => "SHA512-RSA",
        "1.2.840.113549.1.1.5" => "SHA1-RSA",
        "1.2.840.113549.1.1.10" => "RSA-PSS",
        "1.2.840.10045.4.3.2" => "ECDSA-SHA256",
        "1.2.840.10045.4.3.3" => "ECDSA-SHA384",
        "1.2.840.10045.4.3.4" => "ECDSA-SHA512",
        "1.3.101.112" => "Ed25519",
        _ => return oid.to_string(),
    };
    name.to_string()
}

/// A certificate verifier that accepts everything (used only when the user
/// explicitly disables TLS verification). Signature checks still run against the
/// crypto provider's algorithms to avoid a fully broken TLS state machine.
#[derive(Debug)]
struct NoVerifier(WebPkiSupportedAlgorithms);

impl ServerCertVerifier for NoVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_schemes()
    }
}
