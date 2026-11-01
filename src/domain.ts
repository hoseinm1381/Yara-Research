import { newPaper } from "./types";
import type { Paper, Status, Citation } from "./types";
export function normalizeDoi(input: string): string {
  const value = input
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, "")
    .toLowerCase();
  if (!value) return "";
  if (!/^10\.\d{4,9}\/\S+$/.test(value))
    throw new Error("Use a DOI such as 10.1038/s41586-023-06747-5.");
  return value;
}
export function openalexId(input: string): string {
  const id = input.replace(/^https?:\/\/openalex\.org\//i, "");
  return /^W\d+$/i.test(id) ? `https://openalex.org/${id.toUpperCase()}` : "";
}
export function duplicate(p: Paper, papers: Paper[]): Paper | undefined {
  return papers.find(
    (q) =>
      q.id === p.id ||
      (p.doi && q.doi && normalizeDoi(p.doi) === normalizeDoi(q.doi)) ||
      (p.openalex && q.openalex === p.openalex),
  );
}
export function possibleDuplicate(
  p: Paper,
  papers: Paper[],
): Paper | undefined {
  const norm = (s: string) =>
    s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return papers.find((q) => q.id !== p.id && norm(q.title) === norm(p.title));
}
export interface Filters {
  search: string;
  status: Status | "all" | "notes";
  tag: string;
  from: string;
  to: string;
  hideArchived: boolean;
}
export function filterPapers(papers: Paper[], f: Filters): Paper[] {
  return papers.filter(
    (p) =>
      !p.hidden &&
      (!f.hideArchived || p.status !== "archived") &&
      (f.status === "all" ||
        (f.status === "notes" ? p.hasNote : p.status === f.status)) &&
      (!f.tag || p.tags.includes(f.tag)) &&
      (!f.from || (p.year !== null && p.year >= Number(f.from))) &&
      (!f.to || (p.year !== null && p.year <= Number(f.to))) &&
      matches(p, f.search),
  );
}
export function matches(p: Paper, q: string): boolean {
  return [
    p.title,
    ...p.authors,
    p.doi,
    p.year,
    p.status,
    ...p.tags,
    ...p.keywords,
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(q.toLocaleLowerCase());
}
export function citationFor(
  anchor: string,
  other: string,
  direction: "citing" | "references",
): Pick<Citation, "citing" | "cited"> {
  return direction === "citing"
    ? { citing: other, cited: anchor }
    : { citing: anchor, cited: other };
}
export function placeNew(
  existing: Paper[],
  incoming: Paper[],
  anchor?: Paper,
  direction: "citing" | "references" = "citing",
): Paper[] {
  const placed = [...existing];
  return incoming.map((p, i) => {
    const found = duplicate(p, existing);
    if (found) return found;
    let x = anchor
      ? anchor.x + (direction === "citing" ? 390 : -390)
      : (i % 3) * 390;
    let y = anchor ? anchor.y : Math.floor(i / 3) * 210;
    while (
      placed.some((q) => Math.abs(q.x - x) < 330 && Math.abs(q.y - y) < 175)
    )
      y += 205;
    if (!Number.isFinite(x)) x = 0;
    const next = { ...p, x, y };
    placed.push(next);
    return next;
  });
}
export function reconstructAbstract(
  index: Record<string, number[]> | null | undefined,
): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index))
    for (const n of positions)
      if (Number.isInteger(n) && n >= 0 && n < 100000) words[n] = word;
  return words.join(" ");
}
type Work = {
  id?: string;
  title?: string;
  display_name?: string;
  doi?: string;
  publication_year?: number;
  publication_date?: string;
  cited_by_count?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: {
    landing_page_url?: string;
    source?: { display_name?: string; host_organization_name?: string };
  };
  abstract_inverted_index?: Record<string, number[]>;
  referenced_works?: string[];
  keywords?: { display_name: string }[];
};
export function parseOpenAlex(w: Work): Paper {
  if (!w.id || !(w.title || w.display_name))
    throw new Error("Provider returned a work without an identifier or title.");
  return newPaper({
    title: w.title || w.display_name || "",
    openalex: openalexId(w.id),
    doi: w.doi ? normalizeDoi(w.doi) : "",
    authors:
      w.authorships?.flatMap((a) =>
        a.author?.display_name ? [a.author.display_name] : [],
      ) || [],
    year: w.publication_year || null,
    publicationDate: w.publication_date || "",
    citationCount: w.cited_by_count ?? null,
    journal: w.primary_location?.source?.display_name || "",
    publisher: w.primary_location?.source?.host_organization_name || "",
    url: w.primary_location?.landing_page_url || "",
    abstract: reconstructAbstract(w.abstract_inverted_index),
    references: w.referenced_works || [],
    keywords: w.keywords?.map((k) => k.display_name) || [],
    source: "OpenAlex",
  });
}
