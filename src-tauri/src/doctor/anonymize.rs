//! Removing what identifies a person from a diagnostic report before it is shared.
//!
//! - Known personal strings (home folder, user name, logins, project folders) are replaced.
//! - Anything shaped like an e-mail address, a JWT, an API key or a token is masked.
//! - A line that still looks like a secret (`packager::secret_in`) is dropped entirely.

/// Prefixes of API keys and tokens TekBoard may come across.
const KEY_PREFIXES: &[&str] = &["sk-or-", "sk-ant-", "sk-", "ghp_", "gho_", "ghs_", "ghu_", "ghr_", "github_pat_", "glpat-", "xox"];

fn is_email(w: &str) -> bool {
    let Some((user, host)) = w.split_once('@') else { return false };
    !user.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.') && user.chars().all(|c| c.is_ascii_alphanumeric() || "._%+-".contains(c))
}

fn is_token(w: &str) -> bool {
    if w.starts_with("eyJ") && w.len() > 20 && w.matches('.').count() >= 2 {
        return true; // JWT
    }
    if KEY_PREFIXES.iter().any(|p| w.starts_with(p) && w.len() >= p.len() + 12) {
        return true;
    }
    // A long run of letters and digits, mixed (hex or base64 secrets).
    w.len() >= 32 && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) && w.chars().any(|c| c.is_ascii_digit()) && w.chars().any(|c| c.is_ascii_alphabetic())
}

/// Masks one word (punctuation around it kept).
fn mask_word(word: &str) -> String {
    let start = word.find(|c: char| c.is_ascii_alphanumeric()).unwrap_or(word.len());
    let end = word.rfind(|c: char| c.is_ascii_alphanumeric()).map(|i| i + 1).unwrap_or(start);
    if start >= end {
        return word.to_string();
    }
    let (pre, core, post) = (&word[..start], &word[start..end], &word[end..]);
    if is_email(core) {
        format!("{pre}<e-mail>{post}")
    } else if is_token(core) {
        format!("{pre}<jeton masqué>{post}")
    } else {
        word.to_string()
    }
}

/// `personal`: strings to replace, with what replaces them (longest first is handled here).
pub fn anonymize(text: &str, personal: &[(String, String)]) -> String {
    let mut pairs: Vec<&(String, String)> = personal.iter().filter(|(k, _)| k.trim().len() >= 2).collect();
    pairs.sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let mut l = line.to_string();
        for (k, v) in &pairs {
            l = l.replace(k.as_str(), v);
        }
        let masked: Vec<String> = l.split(' ').map(mask_word).collect();
        let l = masked.join(" ");
        if crate::packager::secret_in(&l).is_some() {
            out.push_str("<ligne masquée : elle ressemblait à un secret>\n");
        } else {
            out.push_str(&l);
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_personal_survives() {
        let personal = vec![("/home/jdupont".to_string(), "~".to_string()), ("jdupont".to_string(), "<utilisateur>".to_string()), ("jdupont-gh".to_string(), "<compte GitHub>".to_string())];
        let text = "Racine /home/jdupont/Epitech (jdupont)\nGitHub : connecté (jdupont-gh)\nMY : jean.dupont@epitech.eu\nclé sk-or-v1-0123456789abcdef0123456789abcdef\njeton eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop\nghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345\n-----BEGIN OPENSSH PRIVATE KEY-----\ngit version 2.43.0";
        let out = anonymize(text, &personal);
        for leak in ["jdupont", "jean.dupont", "sk-or-v1", "eyJhbGci", "ghp_", "PRIVATE KEY"] {
            assert!(!out.contains(leak), "{leak} leaked:\n{out}");
        }
        assert!(out.contains("Racine ~/Epitech (<utilisateur>)"), "{out}");
        assert!(out.contains("<compte GitHub>") && out.contains("<e-mail>") && out.contains("<jeton masqué>"));
        assert!(out.contains("git version 2.43.0"), "ordinary facts stay");
    }

    #[test]
    fn ordinary_words_are_kept() {
        let out = anonymize("Ollama 0.5.7 · qwen2.5:7b · 15 Go · https://openrouter.ai/keys", &[]);
        assert_eq!(out.trim(), "Ollama 0.5.7 · qwen2.5:7b · 15 Go · https://openrouter.ai/keys");
    }
}
