import { describe, expect, it } from "vitest";
import type { Capture } from "./api";
import { codeOf, imageRefs, linksOf, shareOf, suggestProject } from "./brain";

const cap = (o: Partial<Capture>): Capture => ({ id: 1, title: "t", text: "", project: null, kind: "idea", ctype: "idea", tags: [], pinned: false, archivedAt: null, doneAt: null, createdAt: 0, updatedAt: null, ...o });
const repo = (path: string, name: string) => ({ path, name, remote: null, epitech: null });

describe("suggestProject", () => {
  const repos = [repo("/p/organized", "organized"), repo("/p/my_ls", "my_ls"), repo("/p/ai", "ai")];
  it("finds the project named in the text, whole words only", () => {
    expect(suggestProject("Penser à libérer les maillons dans Organized avant de quitter", repos)).toBe("/p/organized");
    expect(suggestProject("bug dans my_ls -l", repos)).toBe("/p/my_ls");
    expect(suggestProject("disorganized thoughts", repos)).toBeNull();
    expect(suggestProject("une idée sur l'ai", repos)).toBeNull();
  });
  it("stays silent when two projects match", () => {
    expect(suggestProject("organized et my_ls", repos)).toBeNull();
  });
});

describe("capture content", () => {
  it("extracts code, links and images", () => {
    expect(codeOf(cap({ text: "a\n```Python\nprint(1)\n```" }))).toEqual({ code: "print(1)", lang: "python" });
    expect(codeOf(cap({ text: "$ make re", ctype: "command" }))).toEqual({ code: "make re", lang: "sh" });
    expect(codeOf(cap({ text: "une idée" }))).toBeNull();
    expect(linksOf("voir https://man7.org/fork.2.html, et (http://a.b/c).")).toEqual(["https://man7.org/fork.2.html", "http://a.b/c"]);
    expect(imageRefs("![](capture:0123456789abcdef) ![](capture:0123456789abcdef)")).toEqual(["0123456789abcdef"]);
  });
  it("shares code as a snippet and anything else as a note", () => {
    expect(shareOf(cap({ title: "f", text: "```c\nint x;\n```", ctype: "code" }))).toEqual({ kind: "snippet", title: "f", text: "int x;", lang: "c" });
    expect(shareOf(cap({ title: "idée", text: "idée\nsuite" }))).toEqual({ kind: "note", title: "idée", text: "idée\nsuite" });
  });
});
