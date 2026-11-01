import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Snapshot,
  Paper,
  Note,
  DiscoveryQuery,
  DiscoveryResult,
  Workspace,
  EvidenceSnapshot,
} from "../types";
import { normalizeDoi, duplicate, parseOpenAlex } from "../domain";
export const desktop = isTauri();
const storage = "yara-browser-preview-v1";
const blank = (): Snapshot => ({
  papers: [],
  citations: [],
  settings: {},
  root: "Browser preview — browser storage; desktop uses SQLite and Markdown files",
  workspace: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "My research",
    paperCount: 0,
    active: true,
  },
});
const read = (): Snapshot => {
  const s = JSON.parse(
    localStorage.getItem(storage) || JSON.stringify(blank()),
  ) as Snapshot;
  s.workspace ??= blank().workspace;
  s.papers = s.papers.map((p) => ({ ...p, ieee: p.ieee || "" }));
  s.workspace.paperCount = s.papers.length;
  return s;
};
const write = (s: Snapshot) => localStorage.setItem(storage, JSON.stringify(s));
function template(p: Paper) {
  return `# ${p.title}\n\n## Metadata\n\n- Authors: ${p.authors.join(", ")}\n- Year: ${p.year ?? ""}\n- DOI: ${p.doi}\n\n## Personal Summary\n\n## Important Findings\n\n## Strengths\n\n## Weaknesses\n\n## Methodology\n\n## Research Relevance\n\n## Questions\n\n## Follow-Up Notes\n`;
}
async function preview<T>(
  cmd: string,
  args: Record<string, unknown>,
): Promise<T> {
  const s = read();
  let result: unknown;
  switch (cmd) {
    case "snapshot":
      return s as T;
    case "workspace_revision":
      return `${s.workspace.id}:${s.papers.length}` as T;
    case "list_workspaces": {
      const registry = JSON.parse(
        localStorage.getItem("yara-preview-registry") || "[]",
      ) as Workspace[];
      const workspaces = [
        s.workspace,
        ...registry
          .filter((w) => w.id !== s.workspace.id)
          .map((w) => ({ ...w, active: false })),
      ];
      return workspaces as T;
    }
    case "create_workspace": {
      const next = {
        ...blank(),
        workspace: {
          id: crypto.randomUUID(),
          name: String(args.name),
          paperCount: 0,
          active: false,
        },
      };
      const registry = JSON.parse(
        localStorage.getItem("yara-preview-registry") || "[]",
      ) as Workspace[];
      localStorage.setItem(
        "yara-preview-registry",
        JSON.stringify([
          ...registry.filter((w) => w.id !== s.workspace.id),
          s.workspace,
          next.workspace,
        ]),
      );
      localStorage.setItem(
        `preview-workspace-${next.workspace.id}`,
        JSON.stringify(next),
      );
      return next.workspace as T;
    }
    case "switch_workspace": {
      if (args.id === s.workspace.id) return s as T;
      const raw = localStorage.getItem(`preview-workspace-${args.id}`);
      if (!raw) throw new Error("Workspace unavailable.");
      localStorage.setItem(
        `preview-workspace-${s.workspace.id}`,
        JSON.stringify(s),
      );
      const next = JSON.parse(raw) as Snapshot;
      next.workspace.active = true;
      write(next);
      return next as T;
    }
    case "rename_workspace":
      s.workspace.name = String(args.name).trim();
      result = s.workspace;
      break;
    case "relationship_evidence": {
      const all = JSON.parse(
        localStorage.getItem(`evidence-${s.workspace.id}`) || "[]",
      ) as EvidenceSnapshot[];
      const focal = s.papers.find((p) => p.id === args.id);
      return all.filter(
        (c) =>
          c.direction === args.direction &&
          focal &&
          ((focal.doi && c.focal.doi === focal.doi) ||
            (focal.openalex && c.focal.openalex === focal.openalex) ||
            (focal.ieee && c.focal.ieee === focal.ieee)),
      ) as T;
    }
    case "metadata_sources":
      return [] as T;
    case "cached_discovery": {
      const q = args.query as DiscoveryQuery;
      const raw = localStorage.getItem(cacheIdentity(q));
      return (
        raw ? { ...JSON.parse(raw), cached: true, stale: true } : null
      ) as T;
    }
    case "save_paper":
    case "import_papers": {
      const papers =
        cmd === "save_paper" ? [args.paper as Paper] : (args.papers as Paper[]);
      const saved: Paper[] = [];
      for (const incoming of papers) {
        const p = { ...incoming, doi: normalizeDoi(incoming.doi) };
        if (!p.title.trim()) throw new Error("A paper title is required.");
        const found = duplicate(p, s.papers);
        if (found && cmd === "import_papers") {
          for (const key of [
            "doi",
            "openalex",
            "abstract",
            "journal",
            "publisher",
            "url",
            "publicationDate",
          ] as const) {
            if (!found[key]) found[key] = p[key];
          }
          if (!found.authors.length) found.authors = p.authors;
          if (found.year === null) found.year = p.year;
          found.references = [
            ...new Set([...found.references, ...p.references]),
          ];
          saved.push(found);
          continue;
        }
        if (found && found.id !== p.id)
          throw new Error("This paper already exists.");
        const i = s.papers.findIndex((q) => q.id === p.id);
        p.updatedAt = new Date().toISOString();
        p.hasNote = true;
        if (i < 0) s.papers.push(p);
        else s.papers[i] = p;
        if (localStorage.getItem(`note-${p.id}`) === null)
          localStorage.setItem(`note-${p.id}`, template(p));
        saved.push(p);
      }
      for (const p of saved) {
        if (args.anchor && args.direction && args.anchor !== p.id) {
          const citing =
            args.direction === "citing" ? p.id : String(args.anchor);
          const cited =
            args.direction === "citing" ? String(args.anchor) : p.id;
          if (
            !s.citations.some((e) => e.citing === citing && e.cited === cited)
          )
            s.citations.push({
              citing,
              cited,
              source: p.source,
              verified: p.source === "OpenAlex",
              createdAt: new Date().toISOString(),
            });
        }
      }
      for (const p of s.papers)
        for (const q of s.papers)
          if (
            p.id !== q.id &&
            q.openalex &&
            p.references.includes(q.openalex) &&
            !s.citations.some((e) => e.citing === p.id && e.cited === q.id)
          )
            s.citations.push({
              citing: p.id,
              cited: q.id,
              source:
                p.source === "OpenAlex"
                  ? "OpenAlex references"
                  : "manual references",
              verified: p.source === "OpenAlex",
              createdAt: new Date().toISOString(),
            });
      result = cmd === "save_paper" ? saved[0] : saved;
      break;
    }
    case "save_position": {
      const p = s.papers.find((p) => p.id === args.id);
      if (p) {
        p.x = Number(args.x);
        p.y = Number(args.y);
      }
      break;
    }
    case "reset_demo":
      if (s.papers.some((p) => !p.source.startsWith("Optional demo")))
        throw new Error("Reset is available only for a demo-only workspace.");
      s.papers = [];
      s.citations = [];
      break;
    case "delete_paper":
      s.papers = s.papers.filter((p) => p.id !== args.id);
      s.citations = s.citations.filter(
        (e) => e.citing !== args.id && e.cited !== args.id,
      );
      break;
    case "save_citation": {
      if (args.citing === args.cited)
        throw new Error("A paper cannot cite itself.");
      if (
        !s.citations.some(
          (e) => e.citing === args.citing && e.cited === args.cited,
        )
      )
        s.citations.push({
          citing: String(args.citing),
          cited: String(args.cited),
          source: "manual",
          verified: false,
          createdAt: new Date().toISOString(),
        });
      break;
    }
    case "delete_citation":
      s.citations = s.citations.filter(
        (e) => !(e.citing === args.citing && e.cited === args.cited),
      );
      break;
    case "read_note": {
      const p = s.papers.find((p) => p.id === args.id);
      if (!p) throw new Error("Paper not found.");
      const content = localStorage.getItem(`note-${p.id}`);
      return {
        content: content ?? template(p),
        revision: content ?? "",
        exists: content !== null,
      } as T;
    }
    case "save_note": {
      const content = localStorage.getItem(`note-${args.id}`);
      if ((content ?? "") !== args.revision)
        throw new Error("The note changed externally. Reload before saving.");
      localStorage.setItem(`note-${args.id}`, String(args.content));
      return {
        content: String(args.content),
        revision: String(args.content),
        exists: true,
      } as T;
    }
    case "set_setting":
      s.settings[String(args.key)] = String(args.value);
      break;
    case "set_api_key":
      sessionKey = String(args.key);
      break;
    case "cancel_discovery":
      controller?.abort();
      break;
    case "discover":
      return (await browserDiscover(args.query as DiscoveryQuery)) as T;
    case "open_url": {
      const u = new URL(String(args.url));
      if (!["https:", "http:"].includes(u.protocol))
        throw new Error("Only HTTP and HTTPS links can be opened.");
      window.open(u.href, "_blank", "noopener,noreferrer");
      break;
    }
    default:
      throw new Error(
        "This action requires the desktop application. Browser preview stores its own data separately.",
      );
  }
  write(s);
  return result as T;
}
let sessionKey = "";
let controller: AbortController | null = null;
function cacheIdentity(q: DiscoveryQuery) {
  return `discovery-${read().workspace.id}-${q.mode}-${q.term}-${q.page}`;
}
async function browserDiscover(q: DiscoveryQuery): Promise<DiscoveryResult> {
  const cacheKey = cacheIdentity(q);
  const cached = localStorage.getItem(cacheKey);
  if (cached && !q.refresh) return { ...JSON.parse(cached), cached: true };
  const u = new URL("https://api.openalex.org/works");
  u.searchParams.set("per_page", "50");
  u.searchParams.set("page", String(q.page));
  if (q.mode === "search") {
    if (/^(10\.|doi:|https?:\/\/(dx\.)?doi\.org)/i.test(q.term))
      u.searchParams.set(
        "filter",
        `doi:https://doi.org/${normalizeDoi(q.term)}`,
      );
    else if (/^(https:\/\/openalex.org\/)?W\d+$/i.test(q.term)) {
      u.pathname = `/works/${q.term.split("/").pop()}`;
    } else u.searchParams.set("search", q.term);
  } else
    u.searchParams.set(
      "filter",
      `${q.mode === "citing" ? "cites" : q.mode === "ids" ? "openalex" : "cited_by"}:${q.term}`,
    );
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 20000);
  try {
    const r = await fetch(u, {
      signal: controller.signal,
      headers: sessionKey ? { Authorization: `Bearer ${sessionKey}` } : {},
    });
    if (!r.ok)
      throw new Error(
        `OpenAlex returned HTTP ${r.status}. Try later, configure a free key, or use manual entry.`,
      );
    const data = await r.json();
    const papers = (data.results ?? [data]).map(parseOpenAlex);
    const count = data.meta?.count ?? papers.length;
    const result = {
      papers,
      count,
      page: q.page,
      more: q.page * 50 < count,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    localStorage.setItem(cacheKey, JSON.stringify(result));
    if (q.sessionId && (q.mode === "citing" || q.mode === "references")) {
      const s = read(),
        key = `evidence-${s.workspace.id}`,
        all = JSON.parse(
          localStorage.getItem(key) || "[]",
        ) as EvidenceSnapshot[];
      const id = `${q.sessionId}-${q.mode}`,
        prior = all.find((c) => c.id === id);
      const focal = s.papers.find((p) => p.openalex === q.term);
      if (focal) {
        const items = [...(prior?.items ?? []), ...papers].filter(
          (p, i, a) => a.findIndex((k) => k.openalex === p.openalex) === i,
        );
        const snapshot: EvidenceSnapshot = {
          id,
          provider: "OpenAlex",
          direction: q.mode,
          focal,
          capturedAt: result.fetchedAt,
          sourceUrl: u.href,
          method: "OpenAlex API · controlled pagination",
          coverage: items.length === count ? "complete" : "partial",
          total: count,
          raw: "",
          error: "",
          items,
        };
        localStorage.setItem(
          key,
          JSON.stringify([snapshot, ...all.filter((c) => c.id !== id)]),
        );
      }
    }
    return result;
  } catch (e) {
    if (q.mode === "citing" || q.mode === "references") {
      const s = read(),
        focal = s.papers.find((p) => p.openalex === q.term);
      if (focal) {
        const key = `evidence-${s.workspace.id}`,
          all = JSON.parse(
            localStorage.getItem(key) || "[]",
          ) as EvidenceSnapshot[];
        const failed: EvidenceSnapshot = {
          id: crypto.randomUUID(),
          provider: "OpenAlex",
          direction: q.mode,
          focal,
          capturedAt: new Date().toISOString(),
          sourceUrl: "https://api.openalex.org/works",
          method: "OpenAlex refresh attempt",
          coverage: "failed",
          total: null,
          raw: "",
          error: String(e),
          items: [],
        };
        localStorage.setItem(key, JSON.stringify([failed, ...all]));
      }
    }
    if (cached)
      return {
        ...JSON.parse(cached),
        cached: true,
        stale: true,
        refreshError: String(e),
      };
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
export const backend = {
  call: <T>(cmd: string, args: Record<string, unknown> = {}) =>
    desktop ? invoke<T>(cmd, args) : preview<T>(cmd, args),
  snapshot: () => backend.call<Snapshot>("snapshot"),
  save: (paper: Paper) => backend.call<Paper>("save_paper", { paper }),
  import: (papers: Paper[], anchor?: string, direction?: string) =>
    backend.call<Paper[]>("import_papers", {
      papers,
      anchor: anchor ?? null,
      direction: direction ?? null,
    }),
  readNote: (id: string) => backend.call<Note>("read_note", { id }),
  saveNote: (id: string, content: string, revision: string) =>
    backend.call<Note>("save_note", { id, content, revision }),
  discover: (query: DiscoveryQuery) =>
    backend.call<DiscoveryResult>("discover", { query }),
};
