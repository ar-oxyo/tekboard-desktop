//! What might be slow, read from the source without running it and without AI: nested
//! loops, allocations or I/O inside loops, `strlen` re-evaluated in a loop condition,
//! recursion that calls itself several times, quadratic sorts. Every finding is a
//! hypothesis (`provenance: "heuristique"`): only the measurements say what is really slow.

use serde::Serialize;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hypothesis {
    pub file: String,
    pub function: String,
    pub line: usize,
    /// `nested-loops`, `alloc-in-loop`, `io-in-loop`, `strlen-in-condition`, `recursion`,
    /// `multi-recursion`, `quadratic-sort`.
    pub kind: String,
    /// `high`, `medium`, `low`.
    pub weight: String,
    pub message: String,
    pub provenance: String,
}

const ALLOC: &[&str] = &["malloc", "calloc", "realloc", "strdup", "strndup", "my_strdup", "asprintf"];
const IO: &[&str] = &["printf", "fprintf", "puts", "fputs", "putchar", "write", "read", "fopen", "open", "fflush", "my_putchar", "my_putstr", "my_put_nbr", "getline", "fgets", "scanf", "fscanf"];
const LENGTH: &[&str] = &["strlen", "my_strlen"];

fn text<'a>(n: Node, src: &'a str) -> &'a str {
    n.utf8_text(src.as_bytes()).unwrap_or("")
}

fn is_loop(n: Node) -> bool {
    matches!(n.kind(), "for_statement" | "while_statement" | "do_statement")
}

fn callee<'a>(call: Node, src: &'a str) -> Option<&'a str> {
    let f = call.child_by_field_name("function")?;
    (f.kind() == "identifier").then(|| text(f, src))
}

fn function_name<'a>(def: Node, src: &'a str) -> Option<&'a str> {
    let mut d = def.child_by_field_name("declarator")?;
    loop {
        match d.kind() {
            "function_declarator" => d = d.child_by_field_name("declarator")?,
            "pointer_declarator" | "parenthesized_declarator" => d = d.child_by_field_name("declarator").or_else(|| d.named_child(0))?,
            "identifier" => return Some(text(d, src)),
            _ => return None,
        }
    }
}

struct Walk<'a> {
    src: &'a str,
    file: &'a str,
    func: &'a str,
    out: Vec<Hypothesis>,
    max_depth: usize,
    deepest_line: usize,
    self_calls: usize,
    first_self_call: usize,
    seen: std::collections::BTreeSet<(String, usize)>,
}

impl Walk<'_> {
    fn push(&mut self, line: usize, kind: &str, weight: &str, message: String) {
        if self.seen.insert((kind.to_string(), line)) {
            self.out.push(Hypothesis { file: self.file.to_string(), function: self.func.to_string(), line, kind: kind.into(), weight: weight.into(), message, provenance: "heuristique".into() });
        }
    }

    fn visit(&mut self, n: Node, depth: usize, in_condition: bool) {
        let line = n.start_position().row + 1;
        if n.kind() == "call_expression" {
            if let Some(name) = callee(n, self.src) {
                if name == self.func {
                    self.self_calls += 1;
                    if self.first_self_call == 0 {
                        self.first_self_call = line;
                    }
                }
                if depth > 0 && ALLOC.contains(&name) {
                    self.push(line, "alloc-in-loop", if depth > 1 { "high" } else { "medium" }, format!("{name}() appelé dans une boucle (profondeur {depth}) : une allocation par tour."));
                }
                if depth > 0 && IO.contains(&name) {
                    self.push(line, "io-in-loop", "medium", format!("{name}() dans une boucle : une entrée/sortie par tour, souvent coûteuse (appel système, tampon vidé)."));
                }
                if in_condition && LENGTH.contains(&name) {
                    self.push(line, "strlen-in-condition", "high", format!("{name}() dans la condition d'une boucle : la longueur est recalculée à chaque tour, ce qui rend la boucle quadratique."));
                }
            }
        }
        if is_loop(n) {
            let d = depth + 1;
            if d > self.max_depth {
                self.max_depth = d;
                self.deepest_line = line;
            }
            let mut c = n.walk();
            for child in n.children(&mut c) {
                let cond = n.child_by_field_name("condition").is_some_and(|x| x.id() == child.id());
                self.visit(child, d, cond);
            }
            return;
        }
        let mut c = n.walk();
        for child in n.children(&mut c) {
            self.visit(child, depth, in_condition);
        }
    }
}

/// Hypotheses for one C file.
pub fn analyze(source: &str, file: &str) -> Vec<Hypothesis> {
    let mut parser = Parser::new();
    if parser.set_language(&tree_sitter_c::LANGUAGE.into()).is_err() {
        return vec![];
    }
    let Some(tree) = parser.parse(source, None) else { return vec![] };
    let mut out = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(n) = stack.pop() {
        if n.kind() == "function_definition" {
            let Some(name) = function_name(n, source) else { continue };
            let Some(body) = n.child_by_field_name("body") else { continue };
            let mut w = Walk { src: source, file, func: name, out: Vec::new(), max_depth: 0, deepest_line: 0, self_calls: 0, first_self_call: 0, seen: Default::default() };
            w.visit(body, 0, false);
            let line = n.start_position().row + 1;
            if w.max_depth >= 2 {
                let law = match w.max_depth {
                    2 => "n²",
                    3 => "n³",
                    _ => "n^k",
                };
                w.push(w.deepest_line, "nested-loops", if w.max_depth >= 3 { "high" } else { "medium" }, format!("{} boucles imbriquées : si chacune parcourt les données, le coût croît en {law}.", w.max_depth));
            }
            if w.self_calls >= 2 {
                w.push(w.first_self_call, "multi-recursion", "high", format!("{name}() s'appelle {} fois : sans mémorisation, le nombre d'appels peut croître exponentiellement.", w.self_calls));
            } else if w.self_calls == 1 && w.max_depth > 0 {
                w.push(w.first_self_call, "recursion", "low", format!("{name}() est récursive et contient une boucle : le coût total dépend de la profondeur de récursion."));
            }
            let lower = name.to_lowercase();
            if ["bubble", "selection_sort", "insertion_sort", "naive_sort"].iter().any(|k| lower.contains(k)) && w.max_depth >= 2 {
                w.push(line, "quadratic-sort", "medium", format!("{name}() ressemble à un tri quadratique : qsort() ou un tri fusion font O(n log n)."));
            }
            out.extend(w.out);
            continue;
        }
        let mut c = n.walk();
        for child in n.children(&mut c) {
            stack.push(child);
        }
    }
    out.sort_by(|a, b| a.line.cmp(&b.line));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = r#"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

static void bubble_sort(int *t, int n)
{
    for (int i = 0; i < n; i++)
        for (int j = 0; j + 1 < n - i; j++)
            if (t[j] > t[j + 1]) { int x = t[j]; t[j] = t[j + 1]; t[j + 1] = x; }
}

int count(char const *s)
{
    int c = 0;
    for (int i = 0; i < strlen(s); i++) {
        char *copy = malloc(4);
        printf("%c", s[i]);
        free(copy);
        c++;
    }
    return c;
}

int fib(int n)
{
    return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

int sum(int const *t, int n)
{
    int s = 0;
    for (int i = 0; i < n; i++)
        s += t[i];
    return s;
}
"#;

    #[test]
    fn finds_the_usual_suspects() {
        let h = analyze(SRC, "algo.c");
        let kinds: Vec<(&str, &str)> = h.iter().map(|x| (x.function.as_str(), x.kind.as_str())).collect();
        assert!(kinds.contains(&("bubble_sort", "nested-loops")), "{kinds:?}");
        assert!(kinds.contains(&("bubble_sort", "quadratic-sort")));
        assert!(kinds.contains(&("count", "strlen-in-condition")));
        assert!(kinds.contains(&("count", "alloc-in-loop")));
        assert!(kinds.contains(&("count", "io-in-loop")));
        assert!(kinds.contains(&("fib", "multi-recursion")));
        assert!(!kinds.iter().any(|(f, _)| *f == "sum"), "a single loop is fine: {kinds:?}");
        assert!(h.iter().all(|x| x.provenance == "heuristique" && x.file == "algo.c" && x.line > 0));
        let strlen = h.iter().find(|x| x.kind == "strlen-in-condition").unwrap();
        assert_eq!(strlen.line, 16);
    }

    #[test]
    fn broken_code_does_not_panic() {
        let _ = analyze("int main( { for (;;", "x.c");
        assert!(analyze("", "x.c").is_empty());
    }
}
