import { describe, expect, it } from "vitest";
import { blocks } from "./Markdown";

describe("Tika's markdown", () => {
  it("reads paragraphs, lists, headings and code", () => {
    const b = blocks("# Titre\n\nUn **gras**.\n\n- un\n- deux\n\n1. a\n2. b\n\n```c\nint x;\n```");
    expect(b.map((x) => x.kind)).toEqual(["h", "p", "ul", "ol", "code"]);
    expect(b[2]).toEqual({ kind: "ul", items: ["un", "deux"] });
    expect(b[4]).toEqual({ kind: "code", text: "int x;", lang: "c" });
  });
  it("never needs HTML: tags stay text", () => {
    const b = blocks("<img src=x onerror=alert(1)>");
    expect(b).toEqual([{ kind: "p", text: "<img src=x onerror=alert(1)>" }]);
  });
});
