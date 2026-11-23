// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);
import { display, Select } from "./Select";

const opts = [
  { value: "/p/a", label: "a" },
  { value: "/p/b", label: "b" },
];

describe("Select never fails silently", () => {
  it("shows the chosen label", () => {
    expect(display("/p/a", opts, undefined, undefined)).toEqual({ text: "a", tone: "value" });
  });
  it("a value missing from the list is said, not shown as a blank", () => {
    expect(display("/home/x/old_project", opts, undefined, undefined)).toEqual({ text: "old_project (introuvable)", tone: "missing" });
    render(<Select value="/p/gone" onChange={() => undefined} options={opts} label="Projet" />);
    expect(screen.getByRole("combobox").textContent).toContain("gone (introuvable)");
  });
  it("an empty list explains itself", () => {
    render(<Select value={null} onChange={() => undefined} options={[]} label="Projet" emptyState={{ text: "Aucun dossier de projets configuré." }} />);
    expect(screen.getByRole("combobox").textContent).toContain("Aucun dossier de projets configuré.");
  });
  it("a disabled list says why", () => {
    render(<Select value={null} onChange={() => undefined} options={opts} label="Filtre" disabled disabledReason="Choisis un projet d'abord" showReason />);
    const box = screen.getByRole("combobox");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(box.getAttribute("title")).toBe("Choisis un projet d'abord");
    expect(screen.getByText("Choisis un projet d'abord")).toBeTruthy();
  });
  it("null stays controlled: the placeholder, never the previous value", () => {
    const { rerender } = render(<Select value="/p/a" onChange={() => undefined} options={opts} label="P" placeholder="Choisir" />);
    rerender(<Select value={null} onChange={() => undefined} options={opts} label="P" placeholder="Choisir" />);
    expect(screen.getByRole("combobox").textContent).toContain("Choisir");
  });
});
