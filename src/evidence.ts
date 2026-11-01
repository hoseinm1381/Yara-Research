import type { Paper, EvidenceSnapshot } from "./types";
export function samePaper(a: Paper, b: Paper) {
  if (a.doi && b.doi) return a.doi.toLowerCase() === b.doi.toLowerCase();
  return Boolean(
    (a.openalex && a.openalex === b.openalex) || (a.ieee && a.ieee === b.ieee),
  );
}
export interface ComparisonRow {
  paper: Paper;
  observations: Partial<Record<"OpenAlex" | "IEEE", EvidenceSnapshot[]>>;
  uncertain: boolean;
}
export function comparisonRows(
  papers: Paper[],
  snapshots: EvidenceSnapshot[],
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const add = (paper: Paper) => {
    let row = rows.find((r) => samePaper(r.paper, paper));
    if (!row) {
      row = { paper, observations: {}, uncertain: false };
      rows.push(row);
    }
    return row;
  };
  papers.forEach(add);
  for (const s of snapshots.filter(
    (s) => s.provider === "IEEE" && s.coverage !== "failed",
  ))
    for (const p of s.items) add(p);
  for (const row of rows) {
    for (const provider of ["OpenAlex", "IEEE"] as const) {
      row.observations[provider] = snapshots.filter(
        (s) =>
          s.provider === provider &&
          s.coverage !== "failed" &&
          s.items.some((p) => samePaper(p, row.paper) || p.id === row.paper.id),
      );
    }
    const title = row.paper.title
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    row.uncertain = Boolean(
      title &&
      rows.some(
        (r) =>
          r !== row &&
          r.paper.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ===
            title,
      ),
    );
  }
  return rows;
}
export function sourceState(
  row: ComparisonRow,
  provider: "OpenAlex" | "IEEE",
  snapshots: EvidenceSnapshot[],
) {
  const latest = snapshots
    .filter((s) => s.provider === provider)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
  const observed = row.observations[provider] ?? [];
  if (observed.length) {
    const last = observed
      .slice()
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
    const historical = Boolean(latest && last.id !== latest.id);
    return {
      state: "observed" as const,
      historical,
      text: historical ? "Observed earlier" : "Relationship observed",
      detail: `${last.capturedAt} · ${last.method} · ${last.coverage} capture${historical ? `. Latest capture: ${latest.coverage}; this relationship was not observed in it.` : ""}`,
      snapshot: last,
    };
  }
  if (latest?.coverage === "complete")
    return {
      state: "absent" as const,
      historical: false,
      text: "Not observed in complete snapshot",
      detail: `Complete source snapshot at ${latest.capturedAt}. This is absence from this source list, not a scientific conclusion.`,
      snapshot: latest,
    };
  return {
    state: "unknown" as const,
    historical: false,
    text: "Unknown",
    detail: latest
      ? `Latest ${provider} check: ${latest.coverage} at ${latest.capturedAt}. Unloaded results are not evidence of absence.`
      : "This source has not been checked for this relationship.",
    snapshot: latest,
  };
}
