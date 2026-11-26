// Development only: a TekBoard moulinette plan and report for the browser mock (?mouli=1).
import type { MouliCase, MouliReport, MouliResult, MouliSuite } from "../lib/api";

const io = (id: string, category: string, title: string, args: string[], expectStdout: string | null, expectCode: number | null, source: string): MouliCase => ({ id, category, kind: "io", title, source, args, stdin: null, expectStdout, expectContains: null, expectCode, timeoutMs: 2000, target: null, suite: null, name: null, body: null, enabled: true });
const unit = (id: string, category: string, title: string, target: string, name: string, body: string, source: string): MouliCase => ({ id, category, kind: "unit", title, source, args: [], stdin: null, expectStdout: null, expectContains: null, expectCode: null, timeoutMs: null, target, suite: target, name, body, enabled: true });

const cases: MouliCase[] = [
  io("io-1", "simple", "Ajout puis lecture d'une clé", ["tests/basic.txt"], "secured\n", 0, "sujet : exemple d'utilisation"),
  io("io-2", "erreurs", "Sans argument : code 84", [], null, 84, "convention Epitech : 84"),
  io("io-3", "limites", "Table de taille 1", ["tests/one.txt"], "1\n", 0, "sujet : new_hashtable"),
  io("io-4", "performance", "100 000 insertions en moins d'une seconde", ["tests/big.txt"], null, 0, "sujet : contrainte de temps"),
  io("io-5", "memoire", "Destruction sans fuite", ["tests/basic.txt"], null, 0, "sujet : delete_hashtable libère tout"),
  unit("u-1", "fonctionnel", "hash d'une chaîne vide", "hash", "hash_empty_string_returns_zero", "cr_assert_eq(hash(\"\", 4), 0);", "sujet : hash"),
  unit("u-2", "limites", "Insertion d'une clé déjà présente", "ht_insert", "ht_insert_same_key_replaces_value", "hashtable_t *ht = new_hashtable(&hash, 4);\nht_insert(ht, \"a\", \"1\");\nht_insert(ht, \"a\", \"2\");\ncr_assert_str_eq(ht_search(ht, \"a\"), \"2\");", "sujet : ht_insert"),
  unit("u-3", "robustesse", "Recherche dans une table NULL", "ht_search", "ht_search_null_table_returns_null", "cr_assert_null(ht_search(NULL, \"a\"));", "sujet : gestion des erreurs"),
];

export const mouliSuite: MouliSuite = {
  summary: "Bibliothèque de table de hachage : new_hashtable, delete_hashtable, ht_insert, ht_delete, ht_search, ht_dump. Le binaire de test lit un fichier de commandes et affiche les valeurs trouvées.",
  cases,
  unspecified: ["Clé NULL passée à ht_insert : le sujet ne dit pas quoi faire.", "Ordre d'affichage de ht_dump pour des collisions."],
  rejected: ["« Longueur avec strlen » écarté : appelle des fonctions hors du projet et de Criterion : strlen"],
  files: [
    { name: "test_hash.c", tests: ["hash::hash_empty_string_returns_zero"], content: "/*\n** EPITECH PROJECT, 2026\n** G-CPE-110-LYN-1-1-secured-3\n** File description:\n** test_hash.c\n*/\n\n#include <criterion/criterion.h>\n#include \"hashtable.h\"\n\nTest(hash, hash_empty_string_returns_zero)\n{\n    cr_assert_eq(hash(\"\", 4), 0);\n}\n" },
    { name: "test_ht_insert.c", tests: ["ht_insert::ht_insert_same_key_replaces_value"], content: "/*\n** EPITECH PROJECT, 2026\n** G-CPE-110-LYN-1-1-secured-3\n** File description:\n** test_ht_insert.c\n*/\n\n#include <criterion/criterion.h>\n#include \"hashtable.h\"\n\nTest(ht_insert, ht_insert_same_key_replaces_value)\n{\n    hashtable_t *ht = new_hashtable(&hash, 4);\n\n    ht_insert(ht, \"a\", \"1\");\n    ht_insert(ht, \"a\", \"2\");\n    cr_assert_str_eq(ht_search(ht, \"a\"), \"2\");\n}\n" },
  ],
  withSubject: true,
  createdAt: Math.floor(Date.now() / 1000) - 3600,
};

const r = (c: MouliCase, status: MouliResult["status"], extra: Partial<MouliResult> = {}): MouliResult => ({ id: c.id, title: c.title, category: c.category, kind: c.kind, status, origin: "program", input: c.kind === "unit" ? `Test(${c.suite}, ${c.name})` : c.args.join(" ") || "(sans argument)", expected: null, got: null, stdout: "", stderr: "", code: 0, signal: null, ms: 8, detail: null, ...extra });

export const mouliReport: MouliReport = {
  results: [
    r(cases[0], "passed"),
    r(cases[1], "failed", { code: 0, expected: "84", got: "0", detail: "code de retour" }),
    r(cases[2], "failed", { expected: "1\n", got: "0\n", detail: "sortie standard" }),
    r(cases[3], "timeout", { ms: 2000, code: null, detail: "arrêté après 2000 ms" }),
    r(cases[4], "memory", { stderr: "==4211== 48 bytes in 1 blocks are definitely lost in loss record 1 of 1\n==4211==    at 0x4846828: malloc\n==4211==    by 0x10A1B2: new_hashtable (hashtable.c:21)", detail: "Valgrind signale une erreur mémoire (voir la sortie d'erreur)" }),
    r(cases[5], "passed"),
    r(cases[6], "failed", { detail: "tests/test_ht_insert.c:16: Assertion Failed", expected: cases[6].body }),
    r(cases[7], "crashed", { detail: "The test crashed.", signal: "SIGSEGV (segfault)", code: null }),
  ],
  score: 25,
  build: null,
  finishedAt: Math.floor(Date.now() / 1000) - 600,
};
