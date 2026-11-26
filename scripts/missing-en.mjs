#!/usr/bin/env node
// Lists the French interface strings of the given files (or of every changed .tsx/.ts file)
// that have no English entry in src/locales/en.ts. Development helper, not part of the build.
//   node scripts/missing-en.mjs [files…]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : execFileSync("git", ["diff", "--name-only", "main", "--", "src"], { encoding: "utf8" })
      .split("\n")
      .concat(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "src"], { encoding: "utf8" }).split("\n"))
      .filter((f) => /\.(tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("locales/") && !f.startsWith("src/dev/"));

const en = readFileSync("src/locales/en.ts", "utf8");
const keys = new Set();
for (const m of en.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)) keys.add(JSON.parse(m[1]));

const missing = new Map();
for (const f of new Set(files)) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  // t("…") and plural(n, "…", "…")
  for (const m of text.matchAll(/\b(?:t|tr)\(\s*("(?:[^"\\]|\\.)*")/g)) {
    const k = JSON.parse(m[1]);
    if (!keys.has(k)) missing.set(k, f);
  }
  for (const m of text.matchAll(/\bplural\([^,]+,\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")/g)) {
    for (const s of [m[1], m[2]]) {
      const k = JSON.parse(s);
      if (!keys.has(k)) missing.set(k, f);
    }
  }
}
for (const [k, f] of missing) console.log(`${f}\t${JSON.stringify(k)}`);
console.error(`${missing.size} missing`);
