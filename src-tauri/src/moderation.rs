//! Moderation of public text received or sent over Connect (nicknames): the same list and the
//! same rules as `src/lib/moderation.ts` (`src/lib/moderation.json`), so a peer cannot get
//! around the window's check by talking to the backend directly. Local, no outside service.
//! Slurs, threats and targeted harassment are refused; ordinary swearing is not.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Data {
    categories: HashMap<String, Vec<String>>,
    allow: Vec<String>,
}

struct Rules {
    terms: Vec<(String, Vec<String>)>,
    allow: HashSet<String>,
}

fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| {
        let data: Data = serde_json::from_str(include_str!("../../src/lib/moderation.json")).unwrap_or(Data { categories: HashMap::new(), allow: Vec::new() });
        let mut terms: Vec<(String, Vec<String>)> = data.categories.into_iter().flat_map(|(cat, list)| list.into_iter().map(move |t| (cat.clone(), words(&t)))).collect();
        terms.sort();
        Rules { terms, allow: data.allow.iter().map(|a| words(a).join(" ")).collect() }
    })
}

/// Accented Latin letters to their base letter (what NFKD + dropping marks does in the window).
fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'ı' => 'i',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' => 'u',
        'ý' | 'ÿ' => 'y',
        'š' | 'ś' => 's',
        'ž' | 'ź' | 'ż' => 'z',
        '0' => 'o',
        '1' | '!' | '|' => 'i',
        '3' | '€' => 'e',
        '4' | '@' => 'a',
        '5' | '$' => 's',
        '7' => 't',
        '8' => 'b',
        '£' => 'l',
        c => c,
    }
}

/// Lower case, no accents, look-alikes replaced, runs of 3+ identical letters made one.
pub fn normalize(text: &str) -> String {
    let folded: Vec<char> = text.chars().flat_map(char::to_lowercase).map(fold).collect();
    let mut out = String::with_capacity(folded.len());
    let mut i = 0;
    while i < folded.len() {
        let c = folded[i];
        let mut j = i;
        while j < folded.len() && folded[j] == c {
            j += 1;
        }
        let run = j - i;
        for _ in 0..if run >= 3 { 1 } else { run } {
            out.push(c);
        }
        i = j;
    }
    out
}

/// Words of a text; letters typed one by one with separators are joined.
pub fn words(text: &str) -> Vec<String> {
    let n = normalize(text);
    let mut out = Vec::new();
    let mut run = String::new();
    for w in n.split(|c: char| !c.is_ascii_lowercase()).filter(|w| !w.is_empty()) {
        if w.len() == 1 {
            run.push_str(w);
            continue;
        }
        if !run.is_empty() {
            out.push(std::mem::take(&mut run));
        }
        out.push(w.to_string());
    }
    if !run.is_empty() {
        out.push(run);
    }
    out
}

/// The category of what is refused, or `None` when the text may be shown.
pub fn refused(text: &str) -> Option<&'static str> {
    let r = rules();
    let w: Vec<String> = words(text).into_iter().filter(|x| !r.allow.contains(x)).collect();
    for (cat, term) in &r.terms {
        if term.is_empty() || term.len() > w.len() {
            continue;
        }
        if w.windows(term.len()).any(|win| win == term.as_slice()) {
            return Some(match cat.as_str() {
                "racisme" => "racisme",
                "homophobie" => "homophobie",
                "discrimination" => "discrimination",
                "menace" => "menace",
                _ => "harcelement",
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_rules_as_the_window() {
        assert_eq!(normalize("NÈGRE"), "negre");
        assert_eq!(normalize("neeeeegre"), "negre");
        assert_eq!(words("n . e . g . r . e"), ["negre"]);
        for s in ["sale N3GRE", "t'es qu'un p.d", "je vais te tuer", "kys", "f@ggot", "SALE ARABE"] {
            assert!(refused(s).is_some(), "{s}");
        }
        for s in ["Le Niger et le Nigeria", "envoie le pdf", "je suis en retard", "putain ce bug", "pédagogie", "les arabesques", "Mongolie", "Camille"] {
            assert!(refused(s).is_none(), "{s}");
        }
        assert_eq!(refused("je vais te tuer"), Some("menace"));
    }
}
