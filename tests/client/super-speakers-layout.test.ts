/**
 * Super Speakers layout rules (usability audit 2026-11): how a podium place lays out its tied names,
 * and when the scorer's class buttons wrap instead of scrolling.
 */
import { describe, expect, it } from "vitest";
import { placeDensity } from "../../src/client/board/BoardApp.tsx";
import { CHIPS_WRAP_MAX } from "../../src/client/scorer/ScorerApp.tsx";

describe("board place density", () => {
  it("keeps two or three tied names big, lists four to six, and flows more as chips", () => {
    expect(placeDensity(1)).toBeUndefined();
    expect(placeDensity(2)).toBe("few");
    expect(placeDensity(3)).toBe("few");
    expect(placeDensity(4)).toBe("many");
    expect(placeDensity(6)).toBe("many");
    expect(placeDensity(7)).toBe("crowd");
    expect(placeDensity(40)).toBe("crowd");
  });
});

describe("scorer class buttons", () => {
  it("wrap for a small school and scroll for a big one", () => {
    expect(CHIPS_WRAP_MAX).toBeGreaterThanOrEqual(5);
    expect(CHIPS_WRAP_MAX).toBeLessThan(12);
  });
});
