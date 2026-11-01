import { describe, it, expect } from "vitest";
import {
  normalizeDoi,
  duplicate,
  possibleDuplicate,
  citationFor,
  filterPapers,
  placeNew,
  parseOpenAlex,
  reconstructAbstract,
  matches,
} from "../domain";
import { newPaper, statuses } from "../types";
import { parsePasted } from "../parsers";
const filters = {
  search: "",
  status: "all" as const,
  tag: "",
  from: "",
  to: "",
  hideArchived: false,
};
describe("Identifiers and duplicate prevention", () => {
  it.each([
    "10.1234/ABC",
    "https://doi.org/10.1234/abc",
    "DOI: 10.1234/abc",
    "https://dx.doi.org/10.1234/abc",
  ])("normalizes %s", (doi) => expect(normalizeDoi(doi)).toBe("10.1234/abc"));
  it("rejects malformed DOI", () =>
    expect(() => normalizeDoi("not-a-doi")).toThrow());
  it("reuses DOI matches, regardless of new UUID", () => {
    const a = newPaper({ doi: "10.1234/test" });
    expect(
      duplicate(newPaper({ doi: "https://doi.org/10.1234/TEST" }), [a]),
    ).toBe(a);
  });
  it("uses OpenAlex identifiers", () => {
    const a = newPaper({ openalex: "https://openalex.org/W1" });
    expect(duplicate(newPaper({ openalex: a.openalex }), [a])).toBe(a);
  });
  it("suggests but never merges title-only matches", () => {
    const a = newPaper({ title: "A research paper" }),
      b = newPaper({ title: "A Research Paper!" });
    expect(duplicate(b, [a])).toBeUndefined();
    expect(possibleDuplicate(b, [a])).toBe(a);
  });
});
describe("Graph integrity and filtering", () => {
  it("uses citing → cited in both expansion directions", () => {
    expect(citationFor("A", "B", "citing")).toEqual({
      citing: "B",
      cited: "A",
    });
    expect(citationFor("A", "X", "references")).toEqual({
      citing: "A",
      cited: "X",
    });
  });
  it("keeps pinning, position, notes, and status when importing an existing node", () => {
    const a = newPaper({
      doi: "10.1234/a",
      x: 10,
      y: 12,
      pinned: true,
      status: "core",
      summary: "personal",
    });
    expect(placeNew([a], [newPaper({ doi: a.doi })])[0]).toBe(a);
  });
  it("places references left and citing papers right without overlaps", () => {
    const a = newPaper({ x: 100, y: 100 });
    const right = placeNew([a], [newPaper(), newPaper()], a, "citing");
    const left = placeNew([a], [newPaper()], a, "references");
    expect(right.every((p) => p.x > a.x)).toBe(true);
    expect(left[0].x).toBeLessThan(a.x);
    expect(Math.abs(right[0].y - right[1].y)).toBeGreaterThan(170);
    expect(a.x).toBe(100);
  });
  it("filters do not mutate or delete archived data", () => {
    const a = newPaper({ status: "archived", hasNote: true });
    const arr = [a];
    expect(filterPapers(arr, { ...filters, hideArchived: true })).toEqual([]);
    expect(filterPapers(arr, filters)).toEqual([a]);
    expect(arr).toHaveLength(1);
  });
  it.each(statuses)(
    "supports %s status independently of metadata",
    (status) => {
      const a = newPaper({ status });
      expect(filterPapers([a], { ...filters, status })).toEqual([a]);
    },
  );
  it("combines year, tag, notes, and search filters, excluding unknown years", () => {
    const a = newPaper({
      title: "یادگیری ماشین",
      year: 2024,
      tags: ["方法"],
      hasNote: true,
    });
    expect(
      filterPapers([a, newPaper()], {
        ...filters,
        status: "notes",
        tag: "方法",
        from: "2020",
        to: "2025",
        search: "ماشین",
      }),
    ).toEqual([a]);
    expect(matches(a, "2024")).toBe(true);
  });
});
describe("Scientific metadata", () => {
  it("reconstructs inverted abstracts in positional order", () =>
    expect(reconstructAbstract({ paper: [2], A: [0], scientific: [1] })).toBe(
      "A scientific paper",
    ));
  it("handles missing abstracts and rejects incomplete provider objects", () => {
    expect(reconstructAbstract(null)).toBe("");
    expect(() => parseOpenAlex({})).toThrow();
  });
  it("parses realistic OpenAlex relationships without fabricating edges", () => {
    const p = parseOpenAlex({
      id: "https://openalex.org/W123",
      title: "A paper",
      doi: "https://doi.org/10.1234/a",
      publication_year: 2023,
      authorships: [{ author: { display_name: "Researcher" } }],
      referenced_works: ["https://openalex.org/W456"],
      abstract_inverted_index: { Hello: [0], world: [1] },
    });
    expect(p.references).toEqual(["https://openalex.org/W456"]);
    expect(p.abstract).toBe("Hello world");
    expect(p.authors).toEqual(["Researcher"]);
  });
  it("parses multiple nested BibTeX records and preserves raw source", () => {
    const raw =
      '@article{a, title={The {Transformer} paper}, author={Smith, Jane and Doe, John}, year={2024}, doi={10.1234/a}}\n@book{b, title="Second paper",year=2020}';
    const p = parsePasted(raw);
    expect(p).toHaveLength(2);
    expect(p[0].title).toBe("The Transformer paper");
    expect(p[0].authors).toHaveLength(2);
    expect(p[1].year).toBe(2020);
    expect(p[0].raw).toContain("@article");
  });
  it("parses RIS authors, abstract, and Unicode", () => {
    const p = parsePasted(
      "TY  - JOUR\nTI  - پژوهش 科学\nAU  - Jane Smith\nAU  - John Doe\nPY  - 2022\nDO  - 10.1234/a\nAB  - Abstract text\nER  -",
    )[0];
    expect(p.title).toBe("پژوهش 科学");
    expect(p.authors).toHaveLength(2);
    expect(p.abstract).toBe("Abstract text");
  });
  it("parses IEEE quotation and DOI without guessing authors", () => {
    const p = parsePasted(
      "J. Doe, “A scientific article title,” IEEE Journal, 2021, doi: 10.1234/example.",
    )[0];
    expect(p.title).toBe("A scientific article title");
    expect(p.year).toBe(2021);
    expect(p.doi).toBe("10.1234/example");
    expect(p.authors).toEqual([]);
  });
  it("keeps DOI-only imports untitled for manual review", () => {
    expect(parsePasted("10.1234/example")[0].title).toBe("");
  });
  it("strips HTML scripts from extracted fields and preserves original source", () => {
    const p = parsePasted(
      "<h1>Title: Safe title</h1>\n<script>alert(1)</script>\nYear: 2024",
    )[0];
    expect(p.title).toBe("Safe title");
    expect(p.raw).toContain("<script>");
  });
  it("rejects empty paste input", () =>
    expect(() => parsePasted("   ")).toThrow());
});
