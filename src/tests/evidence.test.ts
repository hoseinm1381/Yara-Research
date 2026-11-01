import { describe, it, expect } from "vitest";
import { newPaper } from "../types";
import type { EvidenceSnapshot } from "../types";
import { comparisonRows, sourceState } from "../evidence";
function capture(
  provider: "IEEE" | "OpenAlex",
  items: ReturnType<typeof newPaper>[],
  coverage: EvidenceSnapshot["coverage"] = "partial",
): EvidenceSnapshot {
  return {
    id: crypto.randomUUID(),
    provider,
    direction: "references",
    focal: newPaper({ title: "A", doi: "10.1234/a" }),
    capturedAt: "2026-11-01T10:00:00Z",
    sourceUrl: "https://ieeexplore.ieee.org/document/726791",
    method: "Fixture",
    coverage,
    total: 10,
    raw: "",
    error: "",
    items,
  };
}
describe("Independent relationship evidence", () => {
  it("merges exact DOI relationships into one row with both badges", () => {
    const b = newPaper({ title: "B", doi: "10.1234/b" });
    const evidence = [
      capture("IEEE", [b]),
      capture("OpenAlex", [{ ...b, id: crypto.randomUUID() }]),
    ];
    const rows = comparisonRows([b], evidence);
    expect(rows).toHaveLength(1);
    expect(sourceState(rows[0], "IEEE", evidence).state).toBe("observed");
    expect(sourceState(rows[0], "OpenAlex", evidence).state).toBe("observed");
  });
  it("shows IEEE-only rows even when OpenAlex has not loaded their page", () => {
    const b = newPaper({ title: "B", doi: "10.1234/b" }),
      c = newPaper({ title: "C", doi: "10.1234/c" });
    const evidence = [capture("IEEE", [b]), capture("OpenAlex", [c])];
    const rows = comparisonRows([c], evidence);
    expect(rows).toHaveLength(2);
    const ieee = rows.find((r) => r.paper.doi === b.doi)!;
    expect(sourceState(ieee, "OpenAlex", evidence).state).toBe("unknown");
  });
  it("absence is stated only for a complete snapshot", () => {
    const b = newPaper({ title: "B", doi: "10.1234/b" });
    const evidence = [
      capture("IEEE", [b]),
      capture("OpenAlex", [], "complete"),
    ];
    expect(
      sourceState(comparisonRows([], evidence)[0], "OpenAlex", evidence).state,
    ).toBe("absent");
    evidence[1].coverage = "failed";
    expect(
      sourceState(comparisonRows([], evidence)[0], "OpenAlex", evidence).state,
    ).toBe("unknown");
  });
  it("paper metadata source alone cannot grant badges", () => {
    const b = newPaper({ title: "B", doi: "10.1234/b", source: "IEEE" });
    const row = comparisonRows([b], [])[0];
    expect(sourceState(row, "IEEE", []).state).toBe("unknown");
  });
  it("uncertain title matches remain separate and cannot grant both-source agreement", () => {
    const b = newPaper({ title: "Same title", doi: "10.1234/b" }),
      c = newPaper({ title: "Same title", doi: "10.1234/c" });
    const evidence = [capture("IEEE", [b]), capture("OpenAlex", [c])];
    const rows = comparisonRows([c], evidence);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.uncertain)).toBe(true);
    expect(
      rows.some(
        (r) => r.observations.IEEE?.length && r.observations.OpenAlex?.length,
      ),
    ).toBe(false);
  });
  it("preserves older IEEE observation when recapture fails or is partial", () => {
    const b = newPaper({ title: "B", doi: "10.1234/b" });
    const old = capture("IEEE", [b]),
      latest = {
        ...capture("IEEE", [], "failed"),
        capturedAt: "2026-11-02T10:00:00Z",
      };
    const evidence = [latest, old];
    const state = sourceState(
      comparisonRows([], evidence)[0],
      "IEEE",
      evidence,
    );
    expect(state.state).toBe("observed");
    expect(state.historical).toBe(true);
    expect(state.detail).toContain("failed");
  });
});
