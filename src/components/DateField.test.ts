import { describe, expect, it } from "vitest";
import { addDays, formatDate, parseDate } from "./DateField";

describe("DateField", () => {
  const today = new Date(2026, 10, 26);
  it("reads days typed day first, in several forms", () => {
    expect(parseDate("26/11/2026", today)).toBe("2026-11-26");
    expect(parseDate("26/11", today)).toBe("2026-11-26");
    expect(parseDate("3.1.27", today)).toBe("2027-01-03");
    expect(parseDate("2026-11-26", today)).toBe("2026-11-26");
  });
  it("refuses what is not a day", () => {
    expect(parseDate("31/02/2026", today)).toBeNull();
    expect(parseDate("13/13", today)).toBeNull();
    expect(parseDate("demain", today)).toBeNull();
    expect(parseDate("", today)).toBeNull();
  });
  it("shows day first and moves across months and years", () => {
    expect(formatDate("2026-11-26")).toBe("26/11/2026");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
