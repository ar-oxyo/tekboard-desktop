//! Mutual TLS 1.3 between two TekBoards. Both sides present their self-signed certificate;
//! the handshake proves each side holds the private key of the certificate it shows (the
//! signatures are verified for real), and TekBoard then pins the certificate's fingerprint:
//! a known contact must come back with the same one. There is no certificate authority.

use super::identity::{fingerprint, Identity};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::server::danger::{ClientCertVerified, ClientCertVerifier};
use rustls::{DigitallySignedStruct, DistinguishedName, SignatureScheme};
use std::sync::Arc;

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

#[derive(Debug)]
struct Pinned {
    algs: WebPkiSupportedAlgorithms,
}

impl Pinned {
    fn new() -> Self {
        Pinned { algs: provider().signature_verification_algorithms }
    }
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(&self, _end: &CertificateDer<'_>, _inter: &[CertificateDer<'_>], _name: &ServerName<'_>, _ocsp: &[u8], _now: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        // Identity is the fingerprint, checked by the caller once the handshake is done.
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

impl ClientCertVerifier for Pinned {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }
    fn verify_client_cert(&self, _end: &CertificateDer<'_>, _inter: &[CertificateDer<'_>], _now: UnixTime) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
    fn client_auth_mandatory(&self) -> bool {
        true
    }
}

fn key(id: &Identity) -> PrivateKeyDer<'static> {
    PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(id.key_der.clone()))
}

pub fn server_config(id: &Identity) -> Result<Arc<rustls::ServerConfig>, rustls::Error> {
    let cfg = rustls::ServerConfig::builder_with_provider(provider()).with_protocol_versions(&[&rustls::version::TLS13])?.with_client_cert_verifier(Arc::new(Pinned::new())).with_single_cert(vec![CertificateDer::from(id.cert_der.clone())], key(id))?;
    Ok(Arc::new(cfg))
}

pub fn client_config(id: &Identity) -> Result<Arc<rustls::ClientConfig>, rustls::Error> {
    let cfg = rustls::ClientConfig::builder_with_provider(provider()).with_protocol_versions(&[&rustls::version::TLS13])?.dangerous().with_custom_certificate_verifier(Arc::new(Pinned::new())).with_client_auth_cert(vec![CertificateDer::from(id.cert_der.clone())], key(id))?;
    Ok(Arc::new(cfg))
}

/// Fingerprint of the certificate the other side proved it holds.
pub fn peer_fp(certs: Option<&[CertificateDer<'_>]>) -> Option<String> {
    certs.and_then(|c| c.first()).map(|c| fingerprint(c.as_ref()))
}
