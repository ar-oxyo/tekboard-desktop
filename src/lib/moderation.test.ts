import { describe, expect, it } from "vitest";
import { check, normalize, refusal, words } from "./moderation";

const bad = (s: string) => !check(s).ok;

describe("moderation", () => {
  it("normalises what is used to get around a filter", () => {
    expect(normalize("NÈGRE")).toBe("negre");
    expect(normalize("p3d3")).toBe("pede");
    expect(normalize("neeeeegre")).toBe("negre");
    expect(words("n . e . g . r . e")).toEqual(["negre"]);
    expect(words("Salut tout le monde")).toEqual(["salut", "tout", "le", "monde"]);
  });

  it("refuses slurs, threats and targeted harassment, however they are written", () => {
    for (const s of ["sale N3GRE", "t'es qu'un p.d", "je vais te tuer", "Je Vais TE TUER demain", "kys", "va te pendre", "SALE ARABE", "n e g r e", "f@ggot", "tarlouze", "grosse pute"]) expect(bad(s), s).toBe(true);
    expect(check("je vais te tuer").category).toBe("menace");
    expect(refusal(check("sale juif"))).toContain("raciste");
  });

  it("lets ordinary words, swearing and lookalikes through", () => {
    for (const s of ["Le Niger et le Nigeria", "envoie le pdf", "je suis en retard", "putain ce bug", "merde, segfault", "un negroni ?", "ma table : algo de tri", "spectacle", "pédagogie", "les arabesques", "gay pride ce week-end", "je vais te montrer", "tuer le processus", "Mongolie", "bicyclette"]) expect(bad(s), s).toBe(false);
    expect(refusal(check("salut"))).toBeNull();
  });
});
