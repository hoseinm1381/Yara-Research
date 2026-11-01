import { newPaper } from "./types";
import type { Paper } from "./types";
export function parsePasted(raw: string): Paper[] {
  if (!raw.trim())
    throw new Error(
      "Paste a citation, BibTeX, RIS, or bibliographic text first.",
    );
  if (raw.length > 2_000_000)
    throw new Error("Import text must be smaller than 2 MB.");
  const bib = raw.match(/@\w+\s*\{/g);
  const chunks = bib
    ? splitBib(raw)
    : /^TY\s+-/m.test(raw)
      ? raw.split(/(?=^TY\s+-)/m).filter((x) => x.trim())
      : raw.split(/\n\s*\n|\n(?=\[\d+\])/).filter((x) => x.trim());
  return chunks.slice(0, 500).map((chunk) => {
    const plain = chunk
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"');
    const p = newPaper({ raw: chunk, source: "pasted text" });
    if (/^@/i.test(chunk.trim())) {
      const fields: Record<string, string> = {};
      const re = /(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|[^,}\n]+)/g;
      let m;
      while ((m = re.exec(chunk)))
        fields[m[1].toLowerCase()] = m[2]
          .replace(/^[{"]|[}"]$/g, "")
          .replace(/[{}]/g, "")
          .trim();
      p.title = fields.title || "";
      p.authors = (fields.author || "").split(/\s+and\s+/i).filter(Boolean);
      p.journal = fields.journal || fields.booktitle || "";
      p.abstract = fields.abstract || "";
      p.doi = fields.doi || "";
      p.url = fields.url || "";
      p.publisher = fields.publisher || "";
      p.year = year(fields.year || "");
      p.keywords = (fields.keywords || "").split(/[,;]/).filter(Boolean);
    } else if (/^TY\s+-/m.test(chunk)) {
      const f: Record<string, string[]> = {};
      for (const line of chunk.split("\n")) {
        const m = line.match(/^([A-Z0-9]{2})\s+-\s?(.*)/);
        if (m) (f[m[1]] ??= []).push(m[2].trim());
      }
      p.title = f.TI?.[0] || f.T1?.[0] || "";
      p.authors = f.AU || f.A1 || [];
      p.doi = f.DO?.[0] || "";
      p.year = year(f.PY?.[0] || f.Y1?.[0] || "");
      p.journal = f.JO?.[0] || f.T2?.[0] || "";
      p.abstract = f.AB?.join("\n") || "";
      p.url = f.UR?.[0] || "";
      p.keywords = f.KW || [];
      p.publisher = f.PB?.[0] || "";
    } else {
      const field = (name: string) =>
        plain
          .match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im"))?.[1]
          ?.trim() || "";
      p.title =
        field("title") ||
        plain.match(/[“"]([^”"]{8,})[”"]/)?.[1]?.replace(/[,;]$/, "") ||
        "";
      p.authors = field("authors?")
        .split(/;|\s+and\s+/)
        .filter(Boolean);
      p.year = year(field("year") || plain);
      p.abstract = field("abstract");
      p.journal = field("journal|conference|venue");
      p.publisher = field("publisher");
      p.keywords = field("keywords?").split(/[,;]/).filter(Boolean);
      p.url = field("url") || plain.match(/https?:\/\/[^\s<>]+/)?.[0] || "";
      if (
        !p.title &&
        !/^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|10\.\d{4,9}\/)/i.test(plain) &&
        !plain.includes("\n")
      )
        p.title = plain.trim();
    }
    p.doi = (p.doi || plain.match(/10\.\d{4,9}\/[^\s<>"{}]+/i)?.[0] || "")
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/[.,;]+$/, "")
      .toLowerCase();
    return p;
  });
}
function year(s: string): number | null {
  const m = s.match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
  return m ? Number(m[1]) : null;
}
function splitBib(s: string): string[] {
  const result: string[] = [];
  let start = -1,
    depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (start < 0 && s[i] === "@") {
      start = i;
      depth = 0;
    }
    if (start >= 0) {
      if (s[i] === "{") depth++;
      if (s[i] === "}" && --depth === 0) {
        result.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }
  if (start >= 0) result.push(s.slice(start));
  return result;
}
