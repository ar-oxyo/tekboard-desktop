#!/usr/bin/env node
// Release helpers, used by .github/workflows/release.yml (and runnable by hand):
//   node scripts/release.mjs check [vX.Y.Z]   versions of package.json, Cargo.toml and
//                                             tauri.conf.json agree (and match the tag)
//   node scripts/release.mjs notes X.Y.Z      the CHANGELOG.md section of that version
//   node scripts/release.mjs manifest X.Y.Z <download base URL> <bundle dir>
//                                             latest.json for the in-app updater, with one
//                                             entry per package format and its signature
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");

function versions() {
  const pkg = JSON.parse(read("package.json")).version;
  const conf = JSON.parse(read("src-tauri/tauri.conf.json")).version;
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1];
  return { "package.json": pkg, "tauri.conf.json": conf, "Cargo.toml": cargo };
}

function check(tag) {
  const v = versions();
  const all = new Set(Object.values(v));
  if (all.size !== 1) {
    console.error("Versions differ:", v);
    process.exit(1);
  }
  const [version] = all;
  if (tag && tag.replace(/^v/, "") !== version) {
    console.error(`Tag ${tag} does not match version ${version}`);
    process.exit(1);
  }
  if (!notes(version, false)) {
    console.error(`CHANGELOG.md has no "## ${version}" section`);
    process.exit(1);
  }
  console.log(version);
}

function notes(version, print = true) {
  const text = read("CHANGELOG.md");
  const start = text.search(new RegExp(`^## \\[?v?${version.replace(/\./g, "\\.")}\\]?`, "m"));
  if (start < 0) return "";
  const rest = text.slice(start);
  const next = rest.slice(3).search(/^## /m);
  const section = (next < 0 ? rest : rest.slice(0, next + 3)).split("\n").slice(1).join("\n").trim();
  if (print) console.log(section);
  return section;
}

function manifest(version, base, dir) {
  const find = (sub, ext) => {
    const d = join(dir, sub);
    if (!existsSync(d)) return null;
    const f = readdirSync(d).find((n) => n.endsWith(ext) && n.includes(`_${version}_`));
    return f ? { name: f, sig: readFileSync(join(d, `${f}.sig`), "utf8").trim() } : null;
  };
  const deb = find("deb", ".deb");
  const appimage = find("appimage", ".AppImage");
  if (!deb && !appimage) {
    console.error(`No signed package for ${version} in ${dir}`);
    process.exit(1);
  }
  const url = (f) => `${base.replace(/\/$/, "")}/${encodeURIComponent(f.name)}`;
  const platforms = {};
  if (appimage) {
    platforms["linux-x86_64-appimage"] = { url: url(appimage), signature: appimage.sig };
    // Older updaters look the plain target up: it is the AppImage.
    platforms["linux-x86_64"] = platforms["linux-x86_64-appimage"];
  }
  if (deb) platforms["linux-x86_64-deb"] = { url: url(deb), signature: deb.sig };
  const out = { version, notes: notes(version, false), pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), platforms };
  console.log(JSON.stringify(out, null, 2));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "check") check(args[0]);
else if (cmd === "notes") notes(args[0] ?? versions()["package.json"]);
else if (cmd === "manifest" && args.length === 3) manifest(...args);
else {
  console.error("usage: release.mjs check [tag] | notes [version] | manifest <version> <base url> <bundle dir>");
  process.exit(2);
}
