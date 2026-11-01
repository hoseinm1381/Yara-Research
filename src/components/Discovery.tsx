import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  RefreshCw,
  LoaderCircle,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { SourceBadges } from "./SourceBadges";
import { backend } from "../services/backend";
import { duplicate } from "../domain";
import { comparisonRows } from "../evidence";
import { labels, statuses } from "../types";
import type {
  Paper,
  DiscoveryResult,
  DiscoveryQuery,
  EvidenceSnapshot,
} from "../types";
export type DiscoveryMode = "search" | "citing" | "references" | "both";
export function Discovery({
  mode,
  anchor,
  existing,
  onImport,
  onClose,
}: {
  mode: DiscoveryMode;
  anchor?: Paper;
  existing: Paper[];
  onImport: (papers: Paper[], direction?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [term, setTerm] = useState(
      mode === "search" ? "" : anchor?.openalex || "",
    ),
    [direction, setDirection] = useState<"citing" | "references">(
      mode === "references" ? "references" : "citing",
    ),
    [result, setResult] = useState<DiscoveryResult | null>(null),
    [papers, setPapers] = useState<Paper[]>([]),
    [evidence, setEvidence] = useState<EvidenceSnapshot[]>([]),
    [chosen, setChosen] = useState(new Set<string>()),
    [drafts, setDrafts] = useState<Record<string, Partial<Paper>>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sort, setSort] = useState("citations"),
    [saving, setSaving] = useState(false);
  const sequence = useRef(0),
    sessions = useRef<Record<string, string>>({}),
    ids = useRef(new Map<string, string>());
  const stable = useCallback(
    (items: Paper[]) =>
      items.map((p) => {
        const key = p.doi || p.openalex || p.ieee || p.id;
        const id = ids.current.get(key) || p.id;
        ids.current.set(key, id);
        return { ...p, id };
      }),
    [],
  );
  const loadEvidence = useCallback(
    async (dir = direction) => {
      if (!anchor || mode === "search") return [];
      return backend.call<EvidenceSnapshot[]>("relationship_evidence", {
        id: anchor.id,
        direction: dir,
      });
    },
    [anchor, direction, mode],
  );
  const run = useCallback(
    async (page = 1, refresh = true, dir = direction, newSession = false) => {
      const seq = ++sequence.current;
      setBusy(true);
      setError("");
      if (!sessions.current[dir] || newSession)
        sessions.current[dir] = crypto.randomUUID();
      const query: DiscoveryQuery = {
        mode: mode === "search" ? "search" : dir,
        term,
        page,
        refresh,
        sessionId: sessions.current[dir],
      };
      try {
        if (page === 1) {
          setChosen(new Set());
          const [cached, saved] = await Promise.all([
            backend.call<DiscoveryResult | null>("cached_discovery", { query }),
            loadEvidence(dir),
          ]);
          if (seq !== sequence.current) return;
          setEvidence(saved);
          setResult(cached);
          setPapers(stable(cached?.papers || []));
        }
        if (mode !== "search" && !term)
          throw new Error(
            "Link this paper to an OpenAlex work ID to refresh OpenAlex. Saved IEEE evidence remains available.",
          );
        const r = await backend.discover(query);
        if (seq !== sequence.current) return;
        setResult(r);
        setPapers((prev) => {
          const next = stable(r.papers);
          return page === 1
            ? next
            : [
                ...prev,
                ...next.filter((p) => !prev.some((q) => q.id === p.id)),
              ];
        });
        setError(r.refreshError || "");
        setEvidence(await loadEvidence(dir));
      } catch (e) {
        if (seq === sequence.current) {
          setError(String(e));
          try {
            setEvidence(await loadEvidence(dir));
          } catch {
            /* The original discovery error remains visible. */
          }
        }
      } finally {
        if (seq === sequence.current) setBusy(false);
      }
    },
    [direction, mode, term, loadEvidence, stable],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode !== "search") void run();
    }, 0);
    return () => {
      clearTimeout(timer);
      void backend.call("cancel_discovery");
    };
  }, [mode, run]);
  useEffect(() => {
    if (mode === "search") return;
    let disposed = false;
    const timer = setInterval(
      () =>
        void loadEvidence()
          .then((e) => {
            if (!disposed) setEvidence(e);
          })
          .catch((e) => {
            if (!disposed) setError(String(e));
          }),
      3000,
    );
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [mode, loadEvidence]);
  const rows = useMemo(
    () =>
      comparisonRows(papers, evidence).map((row) => ({
        ...row,
        paper: { ...row.paper, ...drafts[row.paper.id] },
      })),
    [papers, evidence, drafts],
  );
  const visible = rows
    .filter(
      ({ paper: p }) =>
        (!filter ||
          [p.title, ...p.authors, p.doi]
            .join(" ")
            .toLowerCase()
            .includes(filter.toLowerCase())) &&
        (!from || (p.year !== null && p.year >= +from)) &&
        (!to || (p.year !== null && p.year <= +to)),
    )
    .sort((a, b) =>
      sort === "year"
        ? (b.paper.year ?? 0) - (a.paper.year ?? 0)
        : (b.paper.citationCount ?? 0) - (a.paper.citationCount ?? 0),
    );
  const checkIEEE = async () => {
    if (!anchor) return;
    const url = anchor.ieee
      ? `https://ieeexplore.ieee.org/document/${anchor.ieee}#${direction === "references" ? "references" : "citations"}`
      : `https://ieeexplore.ieee.org/search/searchresult.jsp?queryText=${encodeURIComponent(anchor.doi || anchor.title)}`;
    try {
      await backend.call("open_url", { url });
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Dialog
      title={
        mode === "search"
          ? "Discover papers"
          : mode === "both"
            ? "Explore both directions"
            : direction === "citing"
              ? "Find Citing Papers"
              : "Find Referenced Papers"
      }
      description={
        mode === "search"
          ? "Search OpenAlex by title, DOI, or work ID. Import only what matters."
          : `${direction === "citing" ? "Citing → selected paper" : "Selected paper → referenced work"}. Source badges describe this relationship.`
      }
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        {mode === "search" ? (
          <form
            className="search-line"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            <Search size={18} />
            <input
              aria-label="OpenAlex query"
              placeholder="Paper title, DOI, or OpenAlex ID…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            <button className="primary" disabled={busy || !term.trim()}>
              Search OpenAlex
            </button>
          </form>
        ) : (
          <div className="discovery-anchor">
            <b>{anchor?.title}</b>
            <div className="row">
              <div className="segmented">
                <button
                  className={direction === "references" ? "active" : ""}
                  onClick={() => setDirection("references")}
                >
                  <ArrowDownLeft size={14} />
                  References
                </button>
                <button
                  className={direction === "citing" ? "active" : ""}
                  onClick={() => setDirection("citing")}
                >
                  <ArrowUpRight size={14} />
                  Citing papers
                </button>
              </div>
              <button className="check-ieee" onClick={() => void checkIEEE()}>
                <ExternalLink size={13} />
                Check with IEEE
              </button>
            </div>
            <p className="caption">
              Open the relevant IEEE article section in your browser, then
              explicitly capture it with Send to Yara. Opening this list never
              contacts IEEE.
            </p>
            <div className="coverage-summary">
              {(["OpenAlex", "IEEE"] as const).map((provider) => {
                const latest = evidence
                  .filter((e) => e.provider === provider)
                  .sort(
                    (a, b) =>
                      Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
                  )[0];
                return (
                  <span
                    key={provider}
                    title={
                      latest
                        ? `${latest.capturedAt} · ${latest.method} · ${latest.error || latest.sourceUrl}`
                        : "Not checked"
                    }
                  >
                    <b>{provider}</b>{" "}
                    {provider === "OpenAlex" && busy
                      ? "refreshing"
                      : latest
                        ? `${latest.coverage} · ${latest.items.length}${latest.total !== null ? ` / ${latest.total}` : ""} captured`
                        : "not checked"}
                    {latest && (
                      <small>
                        {new Date(latest.capturedAt).toLocaleString()}
                      </small>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {(result || rows.length > 0) && (
          <>
            <div className="result-toolbar">
              <input
                aria-label="Filter discovery results"
                placeholder="Filter retrieved results…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <input
                aria-label="Discovery from year"
                className="year-input"
                type="number"
                placeholder="From year"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <input
                aria-label="Discovery to year"
                className="year-input"
                type="number"
                placeholder="To year"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <select
                aria-label="Sort discovery results"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="citations">Most cited</option>
                <option value="year">Newest first</option>
              </select>
            </div>
            <div className="result-meta">
              <label>
                <input
                  type="checkbox"
                  checked={
                    visible.length > 0 &&
                    visible.every((r) => chosen.has(r.paper.id))
                  }
                  onChange={(e) =>
                    setChosen(
                      e.target.checked
                        ? new Set(visible.map((r) => r.paper.id))
                        : new Set(),
                    )
                  }
                />
                Select visible
              </label>
              <span>
                {rows.length} comparison rows ·{" "}
                {result
                  ? `${papers.length} / ${result.count.toLocaleString()} OpenAlex results · ${result.cached ? (result.stale ? "stale cache" : "cached") : result.more ? "fresh · partially loaded" : "fresh"}${busy ? " · refreshing" : ""}`
                  : "saved source evidence"}
              </span>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void run(1, true, direction, true)}
              >
                <RefreshCw size={13} />
                Refresh OpenAlex
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => void run()}>Retry OpenAlex</button>
            {result?.cached && (
              <p>
                Showing the last successful cached results. IEEE evidence is
                preserved.
              </p>
            )}
          </div>
        )}
        <div className="discovery-results">
          {visible.map((row) => {
            const p = row.paper,
              saved = duplicate(p, existing);
            return (
              <article key={p.id} className={chosen.has(p.id) ? "checked" : ""}>
                <input
                  type="checkbox"
                  aria-label={`Select ${p.title || p.doi || "untitled reference"}`}
                  checked={chosen.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setChosen(next);
                  }}
                />
                <div>
                  <h3>
                    {p.title ||
                      "Title not available — enter it before importing"}
                  </h3>
                  <p>
                    {p.authors.slice(0, 4).join(", ")}
                    {p.authors.length > 4 ? " et al." : ""}
                  </p>
                  <div className="paper-meta">
                    <span>{p.year ?? "Unknown year"}</span>
                    <span>{p.journal || "Venue unavailable"}</span>
                    <span>{p.citationCount ?? "—"} provider citations</span>
                    {saved && (
                      <span className="saved-label">
                        <Check size={12} />
                        Already in graph
                      </span>
                    )}
                  </div>
                  {mode !== "search" && (
                    <SourceBadges row={row} snapshots={evidence} />
                  )}
                  <details>
                    <summary>
                      Abstract, identifiers & source evidence{" "}
                      <ChevronDown size={12} />
                    </summary>
                    <p>{p.abstract || "No abstract available."}</p>
                    <p className="caption">
                      DOI: {p.doi || "unavailable"} · IEEE article:{" "}
                      {p.ieee || "unavailable"} · {p.openalex}
                    </p>
                    {(!p.title || drafts[p.id]?.title !== undefined) && (
                      <label className="field">
                        Paper title required
                        <input
                          value={drafts[p.id]?.title || ""}
                          onChange={(e) =>
                            setDrafts({
                              ...drafts,
                              [p.id]: {
                                ...drafts[p.id],
                                title: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                    {Object.values(row.observations)
                      .flat()
                      .map((c) => (
                        <p className="caption" key={c.id}>
                          {c.provider} ·{" "}
                          {new Date(c.capturedAt).toLocaleString()} ·{" "}
                          {c.coverage}
                          <br />
                          {c.method}
                          <br />
                          {c.sourceUrl}
                        </p>
                      ))}
                    {p.raw && <pre className="raw-evidence">{p.raw}</pre>}
                  </details>
                </div>
                <select
                  aria-label={`Status for ${p.title}`}
                  value={p.status}
                  onChange={(e) =>
                    setDrafts({
                      ...drafts,
                      [p.id]: {
                        ...drafts[p.id],
                        status: e.target.value as Paper["status"],
                      },
                    })
                  }
                >
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {labels[s]}
                    </option>
                  ))}
                </select>
              </article>
            );
          })}
        </div>
        {busy && (
          <div className="loading">
            <LoaderCircle className="spin" size={19} />
            {result?.cached
              ? "Showing cached results while refreshing OpenAlex…"
              : "Refreshing scientific metadata…"}
            <button
              onClick={() => {
                sequence.current++;
                void backend.call("cancel_discovery");
                setBusy(false);
              }}
            >
              Cancel request
            </button>
          </div>
        )}
        {!busy && result && !visible.length && (
          <div className="small-empty">
            No matching works. Try another search or add a paper manually.
          </div>
        )}
        {!result && !busy && !error && mode === "search" && (
          <div className="search-intro">
            <Search size={38} />
            <h3>One paper opens a new direction.</h3>
            <p>
              Find a starting point in the scientific literature.
              <br />
              Your saved research always works offline.
            </p>
          </div>
        )}
        {result?.more && (
          <button
            className="load-more"
            disabled={busy}
            onClick={() => void run(result.page + 1)}
          >
            Load next 50 results
          </button>
        )}
      </div>
      <footer className="dialog-footer">
        <span className="caption">
          Source comparison does not add graph nodes until you choose them.
        </span>
        <button onClick={onClose}>Close</button>
        <button
          className="primary"
          disabled={saving || !chosen.size}
          onClick={async () => {
            setSaving(true);
            try {
              const selected = rows
                .filter((r) => chosen.has(r.paper.id))
                .map((r) => r.paper);
              if (selected.some((p) => !p.title.trim()))
                throw new Error(
                  "Enter a title for every selected reference before importing.",
                );
              await onImport(
                selected,
                mode === "search" ? undefined : direction,
              );
              onClose();
            } catch (e) {
              setError(String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Adding…" : `Add ${chosen.size} selected`}
        </button>
      </footer>
    </Dialog>
  );
}
