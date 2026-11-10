//! C source inspection with a real parser (tree-sitter), used by the library manager.
//! It reads syntax only: macros are not expanded, so a function produced by a macro is not seen.

use std::collections::BTreeSet;
use tree_sitter::{Node, Parser};

#[derive(Debug, Clone, PartialEq)]
pub struct CFunction {
    pub name: String,
    /// Declaration part, whitespace collapsed: `char *my_strdup(char const *src)`.
    pub signature: String,
    pub is_static: bool,
    /// 1-based.
    pub line: usize,
    pub doc: Option<String>,
    /// Every identifier used in the body (calls and function names passed as values).
    pub refs: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prototype {
    pub name: String,
    pub text: String,
    pub start: usize,
    pub end: usize,
    /// Type names the prototype mentions (`linked_list_t`, `info_param`).
    pub types: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CFile {
    pub functions: Vec<CFunction>,
    pub prototypes: Vec<Prototype>,
    /// `#include "x.h"`.
    pub local_includes: Vec<String>,
    /// Types this file defines (typedef names, named structs/enums/unions with a body).
    pub types: Vec<String>,
    /// Description from the Epitech header comment, when it says more than the file name.
    pub description: Option<String>,
    /// The parser met something it could not understand; results may be partial.
    pub has_errors: bool,
}

impl CFile {
    pub fn exported(&self) -> impl Iterator<Item = &CFunction> {
        self.functions.iter().filter(|f| !f.is_static)
    }
}

pub fn parse(source: &str, file_name: &str) -> CFile {
    let mut parser = Parser::new();
    if parser.set_language(&tree_sitter_c::LANGUAGE.into()).is_err() {
        return CFile { has_errors: true, ..Default::default() };
    }
    let Some(tree) = parser.parse(source, None) else {
        return CFile { has_errors: true, ..Default::default() };
    };
    let root = tree.root_node();
    let mut out = CFile { has_errors: root.has_error(), ..Default::default() };
    visit(root, source, &mut out);
    out.description = header_description(source, file_name);
    out.types.sort();
    out.types.dedup();
    out
}

fn text<'a>(node: Node, src: &'a str) -> &'a str {
    node.utf8_text(src.as_bytes()).unwrap_or("")
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").replace("( ", "(").replace(" )", ")")
}

fn visit(node: Node, src: &str, out: &mut CFile) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_definition" => {
                if let Some(f) = function(child, src) {
                    out.functions.push(f);
                }
            }
            "declaration" => {
                if let Some(p) = prototype(child, src) {
                    out.prototypes.push(p);
                }
                collect_defined_types(child, src, &mut out.types);
            }
            "type_definition" => {
                let mut c = child.walk();
                for d in child.children_by_field_name("declarator", &mut c) {
                    if let Some(name) = innermost_name(d, src) {
                        out.types.push(name);
                    }
                }
                collect_defined_types(child, src, &mut out.types);
            }
            "struct_specifier" | "enum_specifier" | "union_specifier" => collect_defined_types(child, src, &mut out.types),
            "preproc_include" => {
                if let Some(path) = child.child_by_field_name("path") {
                    if path.kind() == "string_literal" {
                        out.local_includes.push(text(path, src).trim_matches('"').to_string());
                    }
                }
            }
            // Header guards, #if blocks, extern "C" wrappers: look inside.
            k if k.starts_with("preproc_") || k == "linkage_specification" || k == "declaration_list" => visit(child, src, out),
            _ => {}
        }
    }
}

/// Named struct/enum/union with a body, anywhere under `node`.
fn collect_defined_types(node: Node, src: &str, types: &mut Vec<String>) {
    if matches!(node.kind(), "struct_specifier" | "enum_specifier" | "union_specifier") && node.child_by_field_name("body").is_some() {
        if let Some(name) = node.child_by_field_name("name") {
            types.push(text(name, src).to_string());
        }
    }
    let mut c = node.walk();
    for child in node.children(&mut c) {
        if child.kind() != "compound_statement" {
            collect_defined_types(child, src, types);
        }
    }
}

/// Follows `declarator` fields down to the declared identifier.
fn innermost_name(mut node: Node, src: &str) -> Option<String> {
    loop {
        match node.kind() {
            "identifier" | "type_identifier" => return Some(text(node, src).to_string()),
            _ => node = node.child_by_field_name("declarator")?,
        }
    }
}

/// The function declarator of a declaration, unless it declares a function pointer.
fn function_declarator(mut node: Node) -> Option<Node> {
    loop {
        match node.kind() {
            "function_declarator" => {
                let inner = node.child_by_field_name("declarator")?;
                return (inner.kind() == "identifier").then_some(node);
            }
            "parenthesized_declarator" | "identifier" => return None,
            _ => node = node.child_by_field_name("declarator")?,
        }
    }
}

fn is_static(node: Node, src: &str) -> bool {
    let mut c = node.walk();
    let found = node.children(&mut c).any(|ch| ch.kind() == "storage_class_specifier" && text(ch, src) == "static");
    found
}

fn function(node: Node, src: &str) -> Option<CFunction> {
    let decl = function_declarator(node.child_by_field_name("declarator")?)?;
    let name = text(decl.child_by_field_name("declarator")?, src).to_string();
    let body = node.child_by_field_name("body")?;
    let signature = collapse(&src[node.start_byte()..body.start_byte()]);
    let mut refs = BTreeSet::new();
    identifiers(body, src, &mut refs);
    refs.remove(&name);
    Some(CFunction { name, signature, is_static: is_static(node, src), line: node.start_position().row + 1, doc: doc_comment(node, src), refs })
}

fn identifiers(node: Node, src: &str, out: &mut BTreeSet<String>) {
    if node.kind() == "identifier" {
        out.insert(text(node, src).to_string());
        return;
    }
    let mut c = node.walk();
    for child in node.children(&mut c) {
        // `s.len` and `p->len` name fields, not functions.
        if child.kind() == "field_identifier" {
            continue;
        }
        identifiers(child, src, out);
    }
}

fn prototype(node: Node, src: &str) -> Option<Prototype> {
    let mut c = node.walk();
    let decl = node.children_by_field_name("declarator", &mut c).find_map(function_declarator)?;
    let name = text(decl.child_by_field_name("declarator")?, src).to_string();
    let mut types = BTreeSet::new();
    type_names(node, src, &mut types);
    Some(Prototype { name, text: text(node, src).to_string(), start: node.start_byte(), end: node.end_byte(), types: types.into_iter().collect() })
}

fn type_names(node: Node, src: &str, out: &mut BTreeSet<String>) {
    if node.kind() == "type_identifier" {
        out.insert(text(node, src).to_string());
    }
    let mut c = node.walk();
    for child in node.children(&mut c) {
        type_names(child, src, out);
    }
}

/// A comment sitting right above the function.
fn doc_comment(node: Node, src: &str) -> Option<String> {
    let prev = node.prev_sibling()?;
    if prev.kind() != "comment" || node.start_position().row.saturating_sub(prev.end_position().row) > 1 {
        return None;
    }
    let cleaned = clean_comment(text(prev, src));
    (!cleaned.is_empty() && !cleaned.contains("EPITECH PROJECT")).then_some(cleaned)
}

fn clean_comment(raw: &str) -> String {
    raw.lines()
        .map(|l| l.trim().trim_start_matches("/*").trim_start_matches("//").trim_end_matches("*/").trim_start_matches('*').trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `File description:` line of the Epitech header, ignored when it only repeats the file name.
fn header_description(src: &str, file_name: &str) -> Option<String> {
    let head: Vec<&str> = src.lines().take(8).collect();
    let at = head.iter().position(|l| l.to_lowercase().contains("file description"))?;
    let desc = head.get(at + 1)?.trim().trim_start_matches("**").trim_start_matches("##").trim();
    let stem = file_name.rsplit('/').next().unwrap_or(file_name);
    let stem_no_ext = stem.rsplit_once('.').map(|(s, _)| s).unwrap_or(stem);
    let norm = |s: &str| s.to_lowercase().replace([' ', '_', '-'], "");
    if desc.is_empty() || desc == "*/" || norm(desc) == norm(stem) || norm(desc) == norm(stem_no_ext) {
        return None;
    }
    Some(desc.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = r#"/*
** EPITECH PROJECT, 2026
** lib
** File description:
** Split a string into words
*/

#include "my.h"
#include <stdlib.h>

static int is_alpha(char c)
{
    return (c >= 'a' && c <= 'z');
}

// Splits on non alphanumeric characters.
char **my_str_to_word_array(char const *str)
{
    int n = my_strlen(str);
    char *copy = my_strdup(str);
    apply(copy, my_strcmp);
    s.my_putchar = 1;

    return is_alpha(n) ? NULL : (char **)copy;
}
"#;

    #[test]
    fn finds_functions_static_flag_and_references() {
        let f = parse(SRC, "my_str_to_word_array.c");
        assert!(!f.has_errors);
        assert_eq!(f.functions.len(), 2);
        assert!(f.functions[0].is_static);
        let main = &f.functions[1];
        assert_eq!(main.name, "my_str_to_word_array");
        assert_eq!(main.signature, "char **my_str_to_word_array(char const *str)");
        assert_eq!(main.doc.as_deref(), Some("Splits on non alphanumeric characters."));
        for name in ["my_strlen", "my_strdup", "my_strcmp", "is_alpha"] {
            assert!(main.refs.contains(name), "{name}");
        }
        assert!(!main.refs.contains("my_putchar"), "a struct field is not a call");
        assert_eq!(f.local_includes, vec!["my.h"]);
        assert_eq!(f.description.as_deref(), Some("Split a string into words"));
    }

    #[test]
    fn description_repeating_the_file_name_is_dropped() {
        let f = parse("/*\n** EPITECH PROJECT, 2026\n** x\n** File description:\n** my_strlen.c\n*/\nint my_strlen(char const *s)\n{\n    return 0;\n}\n", "utils/my_strlen.c");
        assert_eq!(f.description, None);
        assert_eq!(f.functions[0].doc, None);
    }

    #[test]
    fn header_prototypes_types_and_function_pointers() {
        let h = r#"#ifndef MY_H
    #define MY_H
    #include "my_list.h"
    #include <stddef.h>

typedef struct {
    void *data;
} buffer_t;

struct info_param {
    int length;
};

int my_strlen(char const *str);
int my_sort(char **tab,
    int (*cmp)(char const *, char const *));
linked_list_t *my_params_to_list(int ac, char const **av);
extern int (*handler)(int);
int counter;

#endif
"#;
        let f = parse(h, "my.h");
        let names: Vec<&str> = f.prototypes.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["my_strlen", "my_sort", "my_params_to_list"]);
        assert!(f.prototypes[1].text.contains('\n'), "multi-line prototype kept whole");
        assert_eq!(f.prototypes[2].types, vec!["linked_list_t"]);
        assert_eq!(f.types, vec!["buffer_t", "info_param"]);
        assert_eq!(f.local_includes, vec!["my_list.h"]);
        assert_eq!(&h[f.prototypes[0].start..f.prototypes[0].end], "int my_strlen(char const *str);");
    }

    #[test]
    fn broken_code_is_flagged_not_fatal() {
        let f = parse("int ok(void)\n{\n    return 1;\n}\nint broken(int a {\n", "x.c");
        assert!(f.has_errors);
        assert!(f.functions.iter().any(|f| f.name == "ok"));
    }
}
