//! Criterion test files for an Epitech project: the Epitech header, `Test(suite, name)`
//! blocks, and a check of each file with tree-sitter before anyone sees it:
//! - only the project's own functions and Criterion's API may be called (no C library
//!   function, no other library);
//! - an expected value is never computed by the function under test;
//! - names follow `Test(suite, function_behaviour_expected)`.
//! A test that breaks a rule is set aside with the reason, never rewritten silently.

use std::collections::BTreeSet;
use tree_sitter::{Node, Parser};

/// One unit test as the plan describes it.
#[derive(Debug, Clone, PartialEq)]
pub struct UnitTest {
    pub suite: String,
    pub name: String,
    /// Function under test.
    pub target: String,
    /// Statements of the test body (Criterion assertions, project calls, literals).
    pub body: String,
}

/// A generated file and the tests it holds.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestFile {
    /// `test_my_strlen.c`
    pub name: String,
    pub content: String,
    /// `suite::name` of each test in it.
    pub tests: Vec<String>,
}

/// Criterion's API: what a test may call besides the project.
fn criterion_call(name: &str) -> bool {
    name.starts_with("cr_") || matches!(name, "Test" | "TestSuite" | "ParameterizedTest" | "ParameterizedTestParameters" | "Theory" | "TheoryDataPoints" | "DataPoints" | "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "not" | "all" | "any" | "none" | "zero" | "str" | "flt" | "dbl" | "int" | "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64" | "ptr" | "chr" | "sizeof")
}

/// `name` is a valid C identifier in the Epitech style (snake case).
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 80 && name.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c == '_') && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// The Epitech header of a file.
pub fn header(project: &str, year: i32, file: &str) -> String {
    format!("/*\n** EPITECH PROJECT, {year}\n** {project}\n** File description:\n** {file}\n*/\n")
}

fn text<'a>(n: Node, src: &'a str) -> &'a str {
    n.utf8_text(src.as_bytes()).unwrap_or("")
}

fn callee<'a>(call: Node, src: &'a str) -> Option<&'a str> {
    let f = call.child_by_field_name("function")?;
    (f.kind() == "identifier").then(|| text(f, src))
}

/// Calls made anywhere under `n` (function names).
fn calls(n: Node, src: &str, out: &mut Vec<String>) {
    if n.kind() == "call_expression" {
        if let Some(c) = callee(n, src) {
            out.push(c.to_string());
        }
    }
    let mut cur = n.walk();
    for ch in n.children(&mut cur) {
        calls(ch, src, out);
    }
}

/// Problems of one test body, given the project's functions: forbidden calls, an expected
/// value computed by the function under test, a body with no assertion.
pub fn check_body(t: &UnitTest, project: &BTreeSet<String>) -> Vec<String> {
    let src = format!("void f(void)\n{{\n{}\n}}\n", t.body);
    let mut parser = Parser::new();
    if parser.set_language(&tree_sitter_c::LANGUAGE.into()).is_err() {
        return vec!["analyse impossible".into()];
    }
    let Some(tree) = parser.parse(&src, None) else { return vec!["analyse impossible".into()] };
    let root = tree.root_node();
    let mut problems = Vec::new();
    if root.has_error() {
        problems.push("le corps du test n'est pas du C valide".into());
    }
    let mut all = Vec::new();
    calls(root, &src, &mut all);
    let forbidden: BTreeSet<&String> = all.iter().filter(|c| !criterion_call(c) && !project.contains(*c)).collect();
    if !forbidden.is_empty() {
        problems.push(format!("appelle des fonctions hors du projet et de Criterion : {}", forbidden.into_iter().cloned().collect::<Vec<_>>().join(", ")));
    }
    if !all.iter().any(|c| c.starts_with("cr_assert") || c.starts_with("cr_expect")) {
        problems.push("aucune assertion Criterion".into());
    }
    if !project.contains(&t.target) {
        problems.push(format!("« {} » n'est pas une fonction du projet", t.target));
    }
    // An assertion comparing the function with itself proves nothing.
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        if n.kind() == "call_expression" && callee(n, &src).is_some_and(|c| c.starts_with("cr_assert") || c.starts_with("cr_expect")) {
            if let Some(args) = n.child_by_field_name("arguments") {
                let mut cur = args.walk();
                let using: usize = args.named_children(&mut cur).filter(|a| { let mut v = Vec::new(); calls(*a, &src, &mut v); v.iter().any(|c| c == &t.target) }).count();
                if using > 1 {
                    problems.push(format!("la valeur attendue est calculée avec {} elle-même", t.target));
                }
            }
        }
        let mut cur = n.walk();
        for ch in n.children(&mut cur) {
            stack.push(ch);
        }
    }
    if !valid_name(&t.suite) || !valid_name(&t.name) {
        problems.push("nom de suite ou de test invalide (minuscules, chiffres, _)".into());
    } else if !t.name.starts_with(&t.target) {
        problems.push(format!("le nom doit commencer par la fonction testée : {}_comportement_attendu", t.target));
    }
    problems.dedup();
    problems
}

/// Indents a body by four spaces (Epitech style), without trailing spaces.
fn indent(body: &str) -> String {
    body.trim().lines().map(|l| if l.trim().is_empty() { String::new() } else { format!("    {}", l.trim_end()) }).collect::<Vec<_>>().join("\n")
}

/// One file per tested function: `test_<function>.c`, with the project headers it needs.
pub fn assemble(project: &str, year: i32, tests: &[UnitTest], headers: &[String]) -> Vec<TestFile> {
    let mut targets: Vec<&str> = tests.iter().map(|t| t.target.as_str()).collect();
    targets.sort();
    targets.dedup();
    targets
        .into_iter()
        .map(|target| {
            let name = format!("test_{target}.c");
            let mut c = header(project, year, &name);
            c.push_str("\n#include <criterion/criterion.h>\n");
            for h in headers {
                c.push_str(&format!("#include \"{h}\"\n"));
            }
            let mut names = Vec::new();
            for t in tests.iter().filter(|t| t.target == target) {
                c.push_str(&format!("\nTest({}, {})\n{{\n{}\n}}\n", t.suite, t.name, indent(&t.body)));
                names.push(format!("{}::{}", t.suite, t.name));
            }
            TestFile { name, content: c, tests: names }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(target: &str, name: &str, body: &str) -> UnitTest {
        UnitTest { suite: "my_strlen".into(), name: name.into(), target: target.into(), body: body.into() }
    }

    #[test]
    fn a_clean_test_passes_and_forbidden_ones_are_set_aside() {
        let project: BTreeSet<String> = ["my_strlen", "my_strdup"].iter().map(|s| s.to_string()).collect();
        assert!(check_body(&t("my_strlen", "my_strlen_empty_string_returns_zero", "cr_assert_eq(my_strlen(\"\"), 0);"), &project).is_empty());
        // A C library call is refused, even to build an expected value.
        let p = check_body(&t("my_strlen", "my_strlen_hello_returns_five", "cr_assert_eq(my_strlen(\"hello\"), strlen(\"hello\"));"), &project);
        assert!(p.iter().any(|x| x.contains("strlen")), "{p:?}");
        // The function under test may not give its own expected value.
        let p = check_body(&t("my_strlen", "my_strlen_same_returns_same", "cr_assert_eq(my_strlen(\"ab\"), my_strlen(\"ab\"));"), &project);
        assert!(p.iter().any(|x| x.contains("elle-même")), "{p:?}");
        // No assertion, bad name, unknown target.
        assert!(!check_body(&t("my_strlen", "my_strlen_nothing_nothing", "my_strlen(\"a\");"), &project).is_empty());
        assert!(!check_body(&t("my_strlen", "Bad-Name", "cr_assert(1);"), &project).is_empty());
        assert!(!check_body(&t("ghost", "ghost_x_y", "cr_assert(ghost());"), &project).is_empty());
        // Other project functions are fine (a string to compare with, built by my_strdup).
        assert!(check_body(&t("my_strlen", "my_strlen_copy_returns_three", "char *s = my_strdup(\"abc\");\ncr_assert_eq(my_strlen(s), 3);"), &project).is_empty());
    }

    #[test]
    fn files_have_the_epitech_header_and_naming() {
        let files = assemble("G-CPE-100-LYN-1-1-cpoolday12-7", 2026, &[t("my_strlen", "my_strlen_empty_string_returns_zero", "cr_assert_eq(my_strlen(\"\"), 0);")], &["my.h".into()]);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.name, "test_my_strlen.c");
        assert!(f.content.starts_with("/*\n** EPITECH PROJECT, 2026\n** G-CPE-100-LYN-1-1-cpoolday12-7\n** File description:\n** test_my_strlen.c\n*/\n"), "{}", f.content);
        assert!(f.content.contains("#include <criterion/criterion.h>\n#include \"my.h\"\n"));
        assert!(f.content.contains("Test(my_strlen, my_strlen_empty_string_returns_zero)\n{\n    cr_assert_eq(my_strlen(\"\"), 0);\n}\n"));
        assert_eq!(f.tests, ["my_strlen::my_strlen_empty_string_returns_zero"]);
    }
}
