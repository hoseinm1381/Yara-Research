export interface CapturedPaper {
  title: string;
  authors: string[];
  year: number | null;
  doi: string;
  openalex: string;
  ieee: string;
  url: string;
  abstract: string;
  journal: string;
  publisher: string;
  publicationDate: string;
  keywords: string[];
  citationCount: number | null;
  raw: string;
}
export interface PageCapture {
  pageUrl: string;
  provider: "IEEE" | "Web";
  focal: CapturedPaper;
  items: CapturedPaper[];
  direction: "paper" | "references" | "citing";
  coverage: "complete" | "partial" | "unknown";
  total: number | null;
  method: string;
  warning: string;
  diagnostics?: {
    sources: string[];
    fields: string[];
    missing: string[];
    fieldSources: Record<string, string>;
    ready: boolean;
    elapsedMs: number;
    attempts?: number;
  };
}
// This self-contained function runs in the browser's isolated extension world. It reads the
// DOM and structured text only: no page scripts, credentials, fetches, or private endpoints.
export function extractPage(
  direction: "paper" | "references" | "citing" = "paper",
): PageCapture {
  const started = performance.now();
  const pageUrl = location.href;
  const current = new URL(pageUrl);
  if (!["https:", "http:"].includes(current.protocol))
    throw new Error("Open a publisher article page over HTTP or HTTPS.");
  const article =
    current.protocol === "https:" &&
    current.hostname === "ieeexplore.ieee.org" &&
    !current.port
      ? current.pathname.match(
          /^\/(?:abstract\/)?document\/(\d+)(?:\/(?:abstract|authors|figures|references|citations|keywords|metrics|footnotes))?\/?$/,
        )?.[1] || ""
      : "";
  const provider = article ? "IEEE" : "Web";
  if (
    current.hostname === "ieeexplore.ieee.org" &&
    current.protocol === "https:" &&
    !current.port &&
    !article
  )
    throw new Error(
      "Open an IEEE article detail page, rather than search, sign-in or the PDF viewer.",
    );
  const sources: string[] = [],
    fieldSources: Record<string, string> = {};
  const clean = (value: unknown, paragraphs = false): string => {
    if (typeof value !== "string" && typeof value !== "number") return "";
    let result = String(value);
    if (
      /&(?:#\d+|#x[\da-f]+|[a-z]+);|<\/?(?:p|div|span|sub|sup|br|em|strong|i|b|a|script|style|iframe|noscript|math)\b[^>]*>/i.test(
        result,
      )
    ) {
      // An inert template decodes entities/markup without attaching anything or running scripts.
      const template = document.createElement("template");
      template.innerHTML = result
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/(?:p|div)>/gi, "\n\n");
      template.content
        .querySelectorAll("script,style,iframe,noscript")
        .forEach((e) => e.remove());
      result = template.content.textContent || "";
    }
    result = result.normalize("NFC").replace(/\u00a0/g, " ");
    return paragraphs
      ? result
          .replace(/[^\S\n]+/g, " ")
          .replace(/ *\n */g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : result.replace(/\s+/g, " ").trim();
  };
  const unique = (values: string[]) => {
    const seen = new Set<string>();
    return values.filter((s) => {
      const key = s.toLocaleLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const metas = Array.from(document.querySelectorAll("meta")).map((m) => ({
    name: (
      m.getAttribute("name") ||
      m.getAttribute("property") ||
      ""
    ).toLowerCase(),
    value: m.getAttribute("content")?.trim() || "",
  }));
  const meta = (...names: string[]) =>
    metas.find((m) => names.includes(m.name) && m.value)?.value || "";
  const doi = (s: string) => {
    let value = clean(s).replace(/^doi\s*:\s*/i, "");
    if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(value)) {
      try {
        value = decodeURIComponent(new URL(value).pathname.slice(1));
      } catch {
        return "";
      }
    }
    const match = value.match(/10\.\d{4,9}\/[^\s<>"{}]+/i);
    if (!match) return "";
    value = match[0].replace(/[.,;]+$/, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
    ])
      while (
        value.endsWith(close) &&
        value.split(close).length > value.split(open).length
      )
        value = value.slice(0, -1);
    return value.toLowerCase();
  };
  const year = (s: string) => {
    const m = s.match(/\b(?:18|19|20|21)\d{2}\b/);
    return m ? Number(m[0]) : null;
  };
  const date = (value: unknown) => {
    const s = clean(value);
    if (!year(s)) return "";
    const numeric = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?:T.*)?$/);
    if (numeric) {
      const y = +numeric[1],
        m = +numeric[2],
        d = numeric[3] ? +numeric[3] : 1;
      if (
        m < 1 ||
        m > 12 ||
        d < 1 ||
        d > new Date(Date.UTC(y, m, 0)).getUTCDate()
      )
        return "";
    } else if (
      !/^\d{4}$/.test(s) &&
      !/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i.test(
        s,
      )
    )
      return "";
    return s;
  };
  const names = (value: unknown): string[] => {
    const values = Array.isArray(value) ? value : [value];
    return unique(
      values.flatMap((v) => {
        if (Array.isArray(v)) return names(v);
        if (typeof v === "string") return [clean(v)];
        if (v && typeof v === "object") {
          const p = v as Record<string, unknown>;
          return [
            clean(p.name) ||
              [
                clean(p.givenName || p.firstName),
                clean(p.familyName || p.lastName),
              ]
                .filter(Boolean)
                .join(" "),
          ];
        }
        return [];
      }),
    );
  };
  const keywords = (value: unknown): string[] => {
    if (typeof value === "string")
      return unique(value.split(/[;,]/).map((s) => clean(s)));
    if (!Array.isArray(value)) return [];
    return unique(
      value.flatMap((v) =>
        typeof v === "string"
          ? [clean(v)]
          : v && typeof v === "object"
            ? keywords((v as Record<string, unknown>).kwd)
            : [],
      ),
    );
  };
  const numericCount = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0
      ? v
      : typeof v === "string" &&
          /^\d+$/.test(v) &&
          Number.isSafeInteger(Number(v))
        ? Number(v)
        : null;
  // Observed on live IEEE article pages: literal JSON in an inline assignment.
  // Parse the balanced JSON object only, never the surrounding JavaScript or page globals.
  let ieee: Record<string, unknown> | null = null;
  if (article) {
    const canonical = document
      .querySelector('link[rel="canonical"]')
      ?.getAttribute("href");
    if (canonical) {
      const id = new URL(canonical, pageUrl).pathname.match(
        /\/(?:abstract\/)?document\/(\d+)/,
      )?.[1];
      if (id && id !== article)
        throw new Error(
          "The article changed and its metadata is still loading. Retry extraction.",
        );
    }
    for (const script of Array.from(document.scripts).slice(0, 100)) {
      const s = script.textContent || "";
      if (s.length > 1_000_000) continue;
      const m = /(?:window\.)?xplGlobal\.document\.metadata\s*=\s*\{/.exec(s);
      if (!m) continue;
      const start = m.index + m[0].length - 1;
      let depth = 0,
        quoted = false,
        escaped = false,
        end = start;
      for (; end < s.length; end++) {
        const c = s[end];
        if (quoted) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          end++;
          break;
        }
      }
      try {
        const parsed: unknown = JSON.parse(s.slice(start, end));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const p = parsed as Record<string, unknown>;
          const id = clean(p.articleNumber || p.documentId);
          if (id && id !== article) throw new Error("STALE_ARTICLE");
          if (id === article) ieee = p;
        }
      } catch (e) {
        if (e instanceof Error && e.message === "STALE_ARTICLE")
          throw new Error(
            "The article changed and its metadata is still loading. Retry extraction.",
            { cause: e },
          );
        sources.push("IEEE inline JSON: malformed or unsupported");
      }
      if (ieee) {
        sources.push("IEEE inline bibliographic JSON");
        break;
      }
    }
  }
  const nodes: Record<string, unknown>[] = [];
  for (const el of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  ).slice(0, 20)) {
    const text = el.textContent || "";
    if (text.length > 200000) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      const flatten = (v: unknown) => {
        if (Array.isArray(v)) {
          v.forEach(flatten);
          return;
        }
        if (v && typeof v === "object") {
          const obj = v as Record<string, unknown>;
          nodes.push(obj);
          if (obj["@graph"]) flatten(obj["@graph"]);
        }
      };
      flatten(parsed);
    } catch {
      /* Malformed structured data is ignored, never executed. */
    }
  }
  const structured =
    nodes.find(
      (n) =>
        /ScholarlyArticle|Article/.test(String(n["@type"])) &&
        (!article ||
          !String(n.url || n["@id"] || "").match(/\/document\/(\d+)/) ||
          String(n.url || n["@id"]).match(/\/document\/(\d+)/)?.[1] ===
            article),
    ) || {};
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const blank = (title = ""): CapturedPaper => ({
    title,
    authors: [],
    year: null,
    doi: "",
    openalex: "",
    ieee: "",
    url: "",
    abstract: "",
    journal: "",
    publisher: "",
    publicationDate: "",
    keywords: [],
    citationCount: null,
    raw: "",
  });
  const fromObject = (n: Record<string, unknown>): CapturedPaper => {
    const p = blank(text(n.headline) || text(n.name));
    p.url = text(n.url);
    p.doi = doi(text(n.identifier) || p.url);
    if (n.identifier && typeof n.identifier === "object")
      p.doi = doi(JSON.stringify(n.identifier));
    p.abstract = text(n.abstract) || text(n.description);
    p.publicationDate = date(n.datePublished);
    p.year = year(p.publicationDate);
    p.authors = names(n.author);
    p.keywords = keywords(n.keywords);
    if (n.isPartOf && typeof n.isPartOf === "object")
      p.journal = clean((n.isPartOf as Record<string, unknown>).name);
    p.publisher =
      typeof n.publisher === "object" && n.publisher
        ? clean((n.publisher as Record<string, unknown>).name)
        : clean(n.publisher);
    try {
      if (!p.url) return p;
      const u = new URL(p.url, pageUrl);
      if (u.hostname === "ieeexplore.ieee.org")
        p.ieee = u.pathname.match(/\/document\/(\d+)/)?.[1] || "";
    } catch {
      /* Incomplete URL remains editable. */
    }
    return p;
  };
  if (Object.keys(structured).length) sources.push("Article JSON-LD");
  if (metas.some((m) => /^(citation_|dc\.|prism\.|og:|twitter:)/.test(m.name)))
    sources.push("Bibliographic / social meta tags");
  const focal = fromObject(structured),
    data = ieee || {};
  const pick = (field: string, candidates: [unknown, string][]) => {
    for (const [value, source] of candidates) {
      const s = clean(value, field === "abstract");
      if (s) {
        fieldSources[field] = source;
        return s;
      }
    }
    return "";
  };
  const dom = (selector: string) =>
    document.querySelector(selector)?.textContent || "";
  const ieeeTitle = article ? dom("h1.document-title") : "";
  if (
    article &&
    !ieee &&
    !ieeeTitle &&
    !meta("citation_title", "og:title", "twitter:title") &&
    !focal.title &&
    /verify|robot|access denied|sign.?in|javascript is disabled/i.test(
      document.title + " " + (document.body?.textContent || "").slice(0, 1500),
    )
  )
    throw new Error(
      "IEEE article metadata is unavailable on this verification or sign-in page. Open the article in your browser and retry.",
    );
  focal.title = pick("title", [
    [data.title, "IEEE JSON"],
    [focal.title, "JSON-LD"],
    [meta("citation_title", "dc.title"), "Citation tags"],
    [ieeeTitle, "IEEE article heading"],
    [meta("og:title", "twitter:title"), "Article social tags"],
    [document.title.replace(/\s*\|\s*IEEE.*$/i, ""), "Document title"],
  ]);
  const metaAuthors = unique(
    metas
      .filter((m) => ["citation_author", "dc.creator"].includes(m.name))
      .map((m) => clean(m.value)),
  );
  const domAuthors = article
    ? unique(
        Array.from(
          document.querySelectorAll('.authors-info a[href*="/author/"]'),
        ).map((e) => clean(e.textContent)),
      )
    : [];
  const authorCandidates: [
    [string[], string],
    [string[], string],
    [string[], string],
    [string[], string],
  ] = [
    [names(data.authors), "IEEE JSON"],
    [focal.authors, "JSON-LD"],
    [metaAuthors, "Citation tags"],
    [domAuthors, "IEEE author links"],
  ];
  const chosenAuthors = authorCandidates[0][0].length
    ? authorCandidates[0]
    : authorCandidates.slice(1).sort((a, b) => b[0].length - a[0].length)[0];
  focal.authors = chosenAuthors[0];
  if (focal.authors.length) fieldSources.authors = chosenAuthors[1];
  const domDoi = article
    ? document
        .querySelector(
          '.doc-abstract-doi a[href*="doi.org"],a[href^="https://doi.org/"]',
        )
        ?.getAttribute("href") || ""
    : "";
  focal.doi = pick("doi", [
    [doi(clean(data.doi)), "IEEE JSON"],
    [focal.doi, "JSON-LD"],
    [
      doi(meta("citation_doi", "dc.identifier", "prism.doi", "prism:doi")),
      "Citation tags",
    ],
    [doi(domDoi), "IEEE DOI link"],
  ]);
  const metaDate = date(
    meta(
      "citation_publication_date",
      "citation_date",
      "dc.date",
      "prism.publicationdate",
      "prism:publicationdate",
    ),
  );
  const domDate = article
    ? date(
        dom(".doc-abstract-pubdate").replace(
          /^\s*Date of Publication\s*:\s*/i,
          "",
        ),
      )
    : "";
  focal.publicationDate = pick("publicationDate", [
    [date(data.publicationDate), "IEEE bibliographic publication date"],
    [focal.publicationDate, "JSON-LD datePublished"],
    [metaDate, "Citation publication date"],
    [domDate, "Labeled Date of Publication"],
  ]);
  focal.year = year(clean(data.publicationYear)) || year(focal.publicationDate);
  if (focal.year)
    fieldSources.year = data.publicationYear
      ? "IEEE publicationYear"
      : fieldSources.publicationDate;
  focal.journal = pick("journal", [
    [data.publicationTitle, "IEEE JSON"],
    [focal.journal, "JSON-LD"],
    [
      meta(
        "citation_journal_title",
        "citation_conference_title",
        "prism.publicationname",
        "prism:publicationname",
      ),
      "Citation venue",
    ],
    [
      article ? dom("a.stats-document-abstract-publishedIn") : "",
      "IEEE published-in link",
    ],
  ]);
  focal.publisher = pick("publisher", [
    [data.publisher, "IEEE JSON"],
    [focal.publisher, "JSON-LD"],
    [meta("citation_publisher", "dc.publisher"), "Citation tags"],
    [
      article
        ? dom(".doc-abstract-publisher").replace(/^\s*Publisher\s*:\s*/i, "")
        : "",
      "Labeled IEEE publisher",
    ],
  ]);
  const abstracts: [
    [unknown, string],
    [unknown, string],
    [unknown, string],
    [unknown, string],
    [unknown, string],
    [unknown, string],
  ] = [
    [data.abstract, "IEEE JSON"],
    [focal.abstract, "JSON-LD"],
    [meta("citation_abstract", "dc.description"), "Citation abstract"],
    [
      article ? document.querySelector(".abstract-text")?.innerHTML || "" : "",
      "IEEE abstract section",
    ],
    [
      meta("og:description", "twitter:description"),
      "Article social description",
    ],
    [meta("description"), "Generic description"],
  ];
  const available = abstracts
    .map(
      ([s, source]) =>
        [clean(s, true).replace(/^Abstract\s*:\s*/i, ""), source] as [
          string,
          string,
        ],
    )
    .filter(([s]) => s);
  // Full article abstract wins over a truncated social/description preview.
  const completeStructured = available.find(
    ([s, source]) =>
      (source === "IEEE JSON" ||
        (source === "JSON-LD" && structured.abstract)) &&
      !/(?:\.\.\.|…)\s*$/.test(s),
  );
  const best =
    completeStructured ||
    available.sort((a, b) => b[0].length - a[0].length)[0];
  focal.abstract = best?.[0] || "";
  if (best) fieldSources.abstract = best[1];
  focal.keywords = unique([
    ...keywords(data.keywords),
    ...focal.keywords,
    ...keywords(meta("citation_keywords", "keywords", "dc.subject")),
    ...Array.from(document.querySelectorAll('[itemprop="keywords"]')).flatMap(
      (e) => keywords(e.textContent),
    ),
  ]);
  if (focal.keywords.length)
    fieldSources.keywords = data.keywords
      ? "IEEE keyword groups"
      : "Structured / citation keywords";
  focal.citationCount = numericCount(data.citationCount);
  focal.ieee = article;
  focal.url = article
    ? `https://ieeexplore.ieee.org/document/${article}`
    : pageUrl;
  const fields = [
    "title",
    "authors",
    "doi",
    "year",
    "publicationDate",
    "journal",
    "publisher",
    "abstract",
    "keywords",
  ];
  const present = fields.filter((k) => {
    const value = focal[k as keyof CapturedPaper];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  const missing = fields.filter((k) => !present.includes(k));
  if (ieee) {
    // Bibliography only: deliberately exclude userInfo, tokens, purchase options and scripts.
    const safe: Record<string, unknown> = {
      articleNumber: article,
      fieldSources,
    };
    for (const key of [
      "title",
      "doi",
      "publicationYear",
      "publicationDate",
      "displayPublicationDate",
      "publicationTitle",
      "publisher",
      "contentType",
      "volume",
      "issue",
      "startPage",
      "endPage",
      "referenceCount",
      "citationCount",
      "issn",
      "isbn",
      "isOpenAccess",
    ])
      if (data[key] !== undefined) safe[key] = data[key];
    safe.authors = focal.authors;
    safe.keywords = focal.keywords;
    safe.dateNote =
      data.contentType === "conferences"
        ? "displayPublicationDate is the conference date; dateOfInsertion is not publication date."
        : "publicationDate is the bibliographic/issue date; displayPublicationDate may be the online publication date.";
    focal.raw = JSON.stringify(safe);
  }
  const diagnostics = {
    sources,
    fields: present,
    missing,
    fieldSources,
    ready: Boolean(ieee) || present.length >= 6,
    elapsedMs: Math.round(performance.now() - started),
  };
  if (direction === "paper")
    return {
      pageUrl: focal.url,
      provider,
      focal,
      items: [],
      direction,
      coverage: "unknown",
      total: null,
      method: sources.join(" / ") || "Document title only",
      diagnostics,
      warning:
        missing.length >= 7
          ? "Only the paper title could be extracted. Other metadata may be unavailable or the page may still be loading. Review or retry before importing."
          : missing.length
            ? `Some metadata is unavailable: ${missing.join(", ")}. Review the extracted record before importing.`
            : "",
    };
  if (provider !== "IEEE")
    throw new Error(
      "Relationship capture is available only on an IEEE Xplore article page. Generic pages support paper metadata import.",
    );
  const items: CapturedPaper[] = [];
  let method = "Loaded IEEE article section";
  if (direction === "references" && Array.isArray(structured.citation)) {
    for (const c of structured.citation.slice(0, 200)) {
      if (c && typeof c === "object")
        items.push(fromObject(c as Record<string, unknown>));
      else if (typeof c === "string") {
        const p = blank();
        p.doi = doi(c);
        p.raw = c;
        items.push(p);
      }
    }
    if (items.length) method = "IEEE article JSON-LD citation entries";
  }
  const rootSelector =
    direction === "references"
      ? 'xpl-references, #references, [data-testid="references"], [data-yara-section="references"]'
      : 'xpl-citing, xpl-citing-papers, #citations, [data-testid="citing"], [data-yara-section="citing"]';
  const roots = Array.from(document.querySelectorAll(rootSelector));
  if (!items.length) {
    const selector =
      direction === "references"
        ? ".reference-container, .reference, xpl-reference-item, [data-citation], li"
        : ".citing-paper, .List-results-items, [data-citation], li";
    for (const root of roots) {
      const entries = Array.from(root.querySelectorAll(selector))
        .filter(
          (e) =>
            !e.parentElement?.closest(selector) ||
            !root.contains(e.parentElement.closest(selector)),
        )
        .slice(0, 200);
      for (const el of entries) {
        if (
          (el as HTMLElement).hidden ||
          el.getAttribute("aria-hidden") === "true"
        )
          continue;
        const raw = (el.textContent || "").trim();
        if (!raw) continue;
        const p = blank(
          el.getAttribute("data-title") ||
            el
              .querySelector("[data-title],.ref-title,.title,cite")
              ?.textContent?.trim() ||
            el.querySelector('a[href*="/document/"]')?.textContent?.trim() ||
            "",
        );
        p.doi = doi(
          el.getAttribute("data-doi") ||
            el.querySelector('a[href*="doi.org"]')?.getAttribute("href") ||
            raw,
        );
        p.year = year(el.getAttribute("data-year") || raw);
        p.raw = raw.slice(0, 5000);
        const link = el
          .querySelector('a[href*="/document/"],a[href*="doi.org"]')
          ?.getAttribute("href");
        if (link) {
          try {
            const u = new URL(link, pageUrl);
            if (["http:", "https:"].includes(u.protocol)) p.url = u.href;
            if (u.hostname === "ieeexplore.ieee.org")
              p.ieee = u.pathname.match(/\/document\/(\d+)/)?.[1] || "";
          } catch {
            /* Keep the citation text for review. */
          }
        }
        items.push(p);
      }
    }
  }
  const distinct = items.filter((p, i, a) => {
    const key = p.doi || p.ieee;
    return !key || a.findIndex((q) => (q.doi || q.ieee) === key) === i;
  });
  const totals = roots
    .map((r) => r.getAttribute("data-total-count"))
    .filter((s): s is string => s !== null && /^\d+$/.test(s))
    .map(Number);
  const total = totals.length ? Math.max(...totals) : null;
  const complete =
    total !== null &&
    total === distinct.length &&
    roots.some((r) => r.getAttribute("data-pages") === "1");
  const unrecognized = !distinct.length && !(roots.length && total === 0);
  return {
    pageUrl: `https://ieeexplore.ieee.org/document/${article}`,
    provider: "IEEE",
    focal,
    items: distinct,
    direction,
    coverage: complete
      ? "complete"
      : total !== null && distinct.length < total
        ? "partial"
        : "unknown",
    total,
    method,
    diagnostics: {
      ...diagnostics,
      ready: distinct.length > 0 || (roots.length > 0 && total === 0),
    },
    warning: unrecognized
      ? "The loaded relationship section could not be recognized. Open the section and wait for entries, or paste its official BibTeX / RIS export below. No absence has been inferred."
      : complete
        ? "The page explicitly declares a single page and a matching total."
        : "Only the currently loaded, recognized entries were captured. Other pages may exist. No absence claims will be made.",
  };
}
