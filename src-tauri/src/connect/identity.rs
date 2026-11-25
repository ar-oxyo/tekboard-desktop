//! This device's identity for TekBoard Connect: an Ed25519 key and a self-signed certificate,
//! made once and kept in the data folder (0600). Another TekBoard knows this device by the
//! SHA-256 fingerprint of that certificate; nothing else (no account, no server).

use crate::error::{AppError, Result};
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

#[derive(Clone)]
pub struct Identity {
    pub cert_der: Vec<u8>,
    pub key_der: Vec<u8>,
    /// Hex SHA-256 of the certificate (64 characters).
    pub fp: String,
}

pub fn fingerprint(cert_der: &[u8]) -> String {
    Sha256::digest(cert_der).iter().map(|b| format!("{b:02x}")).collect()
}

/// Short form shown in lists: `3f2a·91c0·77de`.
pub fn short(fp: &str) -> String {
    fp.as_bytes().chunks(4).take(3).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("·")
}

/// The code both people read aloud when they pair: the same on both sides, derived from both
/// fingerprints. A different code means someone sits in the middle.
pub fn pairing_code(a: &str, b: &str) -> String {
    let (x, y) = if a <= b { (a, b) } else { (b, a) };
    let h = Sha256::digest(format!("tekboard-pair:{x}:{y}").as_bytes());
    let n = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) % 1_000_000;
    format!("{:03} {:03}", n / 1000, n % 1000)
}

pub fn is_fingerprint(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Loads the identity in `dir`, or makes one.
pub fn load_or_create(dir: &Path) -> Result<Identity> {
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    let (cert_path, key_path) = (dir.join("device.crt.der"), dir.join("device.key.der"));
    if let (Ok(cert_der), Ok(key_der)) = (std::fs::read(&cert_path), std::fs::read(&key_path)) {
        if !cert_der.is_empty() && !key_der.is_empty() {
            return Ok(Identity { fp: fingerprint(&cert_der), cert_der, key_der });
        }
    }
    let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ED25519).map_err(|e| AppError::new("identity", format!("Clé impossible à créer : {e}")))?;
    let mut params = rcgen::CertificateParams::new(vec!["tekboard.local".to_string()]).map_err(|e| AppError::new("identity", e.to_string()))?;
    params.distinguished_name.push(rcgen::DnType::CommonName, "TekBoard device");
    // Far in the future: the certificate is pinned by fingerprint, never checked by date.
    params.not_after = rcgen::date_time_ymd(2099, 1, 1);
    let cert = params.self_signed(&key).map_err(|e| AppError::new("identity", format!("Certificat impossible à créer : {e}")))?;
    let (cert_der, key_der) = (cert.der().to_vec(), key.serialize_der());
    for (path, bytes) in [(&key_path, &key_der), (&cert_path, &cert_der)] {
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, bytes)?;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        std::fs::rename(&tmp, path)?;
    }
    Ok(Identity { fp: fingerprint(&cert_der), cert_der, key_der })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_made_once_and_kept_private() {
        let dir = tempfile::tempdir().unwrap();
        let a = load_or_create(dir.path()).unwrap();
        let b = load_or_create(dir.path()).unwrap();
        assert_eq!(a.fp, b.fp);
        assert!(is_fingerprint(&a.fp));
        let mode = std::fs::metadata(dir.path().join("device.key.der")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let other = load_or_create(&dir.path().join("other")).unwrap();
        assert_ne!(a.fp, other.fp);
    }

    #[test]
    fn pairing_codes_match_on_both_sides() {
        let (a, b) = ("a".repeat(64), "b".repeat(64));
        assert_eq!(pairing_code(&a, &b), pairing_code(&b, &a));
        assert_ne!(pairing_code(&a, &b), pairing_code(&a, &"c".repeat(64)));
        assert_eq!(pairing_code(&a, &b).len(), 7);
        assert_eq!(short(&a), "aaaa·aaaa·aaaa");
        assert!(!is_fingerprint("ABC"));
    }
}
