//! Counts of the Skill Tree built from a TekBoard database (no names printed).
//! cargo run --example skilltree_check -- <tekboard.db>
fn main() {
    let path = std::env::args().nth(1).expect("path to tekboard.db");
    let conn = tekboard_lib::db::open(std::path::Path::new(&path)).unwrap();
    let t = tekboard_lib::skilltree::build(&conn);
    let mut by: std::collections::BTreeMap<(String, String), usize> = Default::default();
    for n in &t.nodes {
        *by.entry((n.kind.to_string(), n.status.to_string())).or_default() += 1;
    }
    println!("credits {:?}", t.credits);
    println!("semester {:?} semesters {}", t.semester, t.semesters.len());
    for b in &t.branches {
        println!("branch units={} threshold={:?} secure={:?}", b.units.len(), b.threshold, b.secure);
    }
    for ((k, s), n) in by {
        println!("{k:8} {s:12} {n}");
    }
    println!("links {} (project_skill {})", t.links.len(), t.links.iter().filter(|l| l.kind == "project_skill").count());
    println!("units with estimated domain {}", t.nodes.iter().filter(|n| n.kind == "unit" && n.domain_estimated).count());
    println!("projects without branch {}", t.nodes.iter().filter(|n| n.kind == "project" && n.branch.is_none()).count());
    println!("history {} notes {:?}", t.history.len(), t.notes);
}
