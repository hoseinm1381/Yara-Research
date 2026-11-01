import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  readActivePage,
  assertActivePage,
  paperFromCapture,
  paperPayload,
  sendToYara,
} from "./client";
import type { ExtensionAPI } from "./client";
import type { PageCapture } from "./capture";
import { newPaper } from "../src/types";
import type { Paper, Workspace, EvidenceSnapshot } from "../src/types";
import { parsePasted } from "../src/parsers";
import "./popup.css";
declare const chrome: ExtensionAPI;
function Popup() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspace, setWorkspace] = useState(""),
    [capture, setCapture] = useState<PageCapture | null>(null),
    [focal, setFocal] = useState<Paper>(newPaper()),
    [items, setItems] = useState<Paper[]>([]),
    [chosen, setChosen] = useState(new Set<string>()),
    [coverage, setCoverage] = useState<"complete" | "partial" | "unknown">(
      "unknown",
    ),
    [total, setTotal] = useState(""),
    [verifiedFull, setVerifiedFull] = useState(false),
    [raw, setRaw] = useState(""),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const delivery = useRef<{ signature: string; id: string } | null>(null);
  const list = useCallback(async () => {
    try {
      const response = await sendToYara(chrome, {
        version: 1,
        requestId: crypto.randomUUID(),
        action: "list_workspaces",
      });
      if (!response.ok) throw new Error(response.error);
      const list = response.workspaces || [];
      setWorkspaces(list);
      setWorkspace((current) =>
        list.some((w) => w.id === current)
          ? current
          : list.find((w) => w.active)?.id || list[0]?.id || "",
      );
      setConnectionError("");
    } catch (e) {
      setConnectionError(
        `Yara could not be reached. Install Yara Research 1.1 with its browser bridge, then retry. ${String(e)}`,
      );
    }
  }, []);
  const read = useCallback(
    async (direction: "paper" | "references" | "citing") => {
      setBusy(true);
      setError("");
      setStatus("Extracting metadata…");
      setCapture(null);
      try {
        const data = await readActivePage(chrome, direction);
        setCapture(data);
        setRaw("");
        setFocal(paperFromCapture(data.focal, data.provider));
        const papers = data.items.map((p) =>
          paperFromCapture(p, "IEEE metadata"),
        );
        setItems(papers);
        setChosen(new Set(papers.map((p) => p.id)));
        setCoverage(data.coverage);
        setTotal(data.total === null ? "" : String(data.total));
        setVerifiedFull(false);
        delivery.current = null;
        setStatus(
          data.warning
            ? "Partially extracted — review the available metadata."
            : "Ready to import.",
        );
        if (import.meta.env.DEV)
          console.debug("Yara extraction", {
            url: data.pageUrl,
            articleId: data.focal.ieee,
            ...data.diagnostics,
          });
      } catch (e) {
        setError(String(e));
        setStatus("Extraction failed.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      void list();
      void read("paper");
    }, 0);
    return () => clearTimeout(timer);
  }, [list, read]);
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      if (!workspace) throw new Error("Choose a real destination workspace.");
      if (!focal.title.trim()) throw new Error("Enter the focal paper title.");
      if (!capture) throw new Error("Read an article page first.");
      await assertActivePage(chrome, capture.pageUrl);
      setStatus("Importing…");
      const selected = items.filter((p) => chosen.has(p.id));
      let payload = paperPayload(workspace, focal, capture);
      if (capture.direction !== "paper") {
        if (capture.provider !== "IEEE")
          throw new Error("Open an IEEE article to capture relationships.");
        if (
          coverage === "complete" &&
          !verifiedFull &&
          capture.coverage !== "complete"
        )
          throw new Error(
            "Confirm that the full list across all pages was captured, or select Partial / Unknown.",
          );
        if (coverage === "complete" && Number(total) !== selected.length)
          throw new Error(
            "Complete coverage needs a known total matching all selected entries.",
          );
        const evidence: EvidenceSnapshot = {
          id: focal.id,
          provider: "IEEE",
          direction: capture.direction,
          focal,
          capturedAt: focal.createdAt,
          sourceUrl: capture.pageUrl,
          method: verifiedFull
            ? `${capture.method} · user-confirmed full list`
            : capture.method,
          coverage,
          total: total ? Number(total) : null,
          raw: raw.slice(0, 200000),
          error: "",
          items: selected,
        };
        payload = {
          version: 1,
          action: "capture_relationships",
          workspaceId: workspace,
          capture: evidence,
          pageUrl: capture.pageUrl,
          provider: "IEEE",
        };
      }
      const signature = JSON.stringify(payload);
      if (delivery.current?.signature !== signature)
        delivery.current = { signature, id: crypto.randomUUID() };
      payload.requestId = delivery.current.id;
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 500000)
        throw new Error(
          "The capture is too large. Select a smaller batch and mark coverage Partial.",
        );
      if (import.meta.env.DEV)
        console.debug("Yara import", {
          fields: Object.keys(focal),
          action: payload.action,
        });
      const response = await sendToYara(chrome, payload);
      if (!response.ok)
        throw new Error(response.error || "Yara rejected this import.");
      setStatus(response.message || "Saved in the selected workspace.");
    } catch (e) {
      setError(String(e));
      setStatus(
        "Import failed. Your preview remains available for review or retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main>
      <header>
        <img src="icon.png" alt="" />
        <div>
          <h1>Send to Yara</h1>
          <p>Your browser. Your research workspace.</p>
        </div>
      </header>
      <div className="actions">
        <button disabled={busy} onClick={() => void read("paper")}>
          Read paper metadata
        </button>
        <button disabled={busy} onClick={() => void read("references")}>
          Capture loaded references
        </button>
        <button disabled={busy} onClick={() => void read("citing")}>
          Capture loaded citing papers
        </button>
      </div>
      <label>
        Destination workspace
        <div className="workspace-row">
          <select
            aria-label="Destination workspace"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          >
            {!workspaces.length && (
              <option value="">No workspace available</option>
            )}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.paperCount} papers
                {w.active ? " · open in Yara" : ""}
              </option>
            ))}
          </select>
          <button onClick={() => void list()} disabled={busy}>
            Retry connection
          </button>
        </div>
      </label>
      {capture && (
        <>
          <div className="source-label">
            {capture.provider === "IEEE"
              ? "IEEE Xplore article"
              : "Generic bibliographic metadata"}{" "}
            ·{" "}
            {capture.direction === "paper"
              ? "paper import"
              : capture.direction === "references"
                ? "focal → references"
                : "citing papers → focal"}
          </div>
          <label>
            Focal paper title
            <input
              aria-label="Focal paper title"
              value={focal.title}
              onChange={(e) => setFocal({ ...focal, title: e.target.value })}
            />
          </label>
          <div className="fields">
            <label>
              DOI
              <input
                aria-label="Paper DOI"
                value={focal.doi}
                onChange={(e) => setFocal({ ...focal, doi: e.target.value })}
              />
            </label>
            <label>
              IEEE article ID
              <input value={focal.ieee} readOnly />
            </label>
            <label>
              Authors, separated by semicolons
              <input
                value={focal.authors.join(";")}
                onChange={(e) =>
                  setFocal({
                    ...focal,
                    authors: e.target.value.split(";").filter(Boolean),
                  })
                }
              />
            </label>
            <label>
              Year
              <input
                type="number"
                value={focal.year ?? ""}
                onChange={(e) =>
                  setFocal({
                    ...focal,
                    year: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </label>
          </div>
          <div className="fields">
            <label>
              Journal / conference
              <input
                aria-label="Publication venue"
                value={focal.journal}
                onChange={(e) =>
                  setFocal({ ...focal, journal: e.target.value })
                }
              />
            </label>
            <label>
              Publisher
              <input
                aria-label="Publisher"
                value={focal.publisher}
                onChange={(e) =>
                  setFocal({ ...focal, publisher: e.target.value })
                }
              />
            </label>
            <label>
              Bibliographic publication date
              <input
                aria-label="Publication date"
                value={focal.publicationDate}
                onChange={(e) =>
                  setFocal({ ...focal, publicationDate: e.target.value })
                }
              />
            </label>
            <label>
              Keywords / index terms, separated by semicolons
              <input
                aria-label="Keywords / index terms"
                value={focal.keywords.join("; ")}
                onChange={(e) =>
                  setFocal({
                    ...focal,
                    keywords: e.target.value
                      .split(";")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>
          <details className="abstract-preview">
            <summary>
              {focal.abstract
                ? `Abstract available · ${focal.abstract.length} characters`
                : "Abstract unavailable — add manually if needed"}
            </summary>
            <textarea
              aria-label="Paper abstract"
              value={focal.abstract}
              onChange={(e) => setFocal({ ...focal, abstract: e.target.value })}
              placeholder="No abstract was found on this page."
            />
          </details>
          <p className="url">{capture.pageUrl}</p>
          {capture.warning && <p className="notice">{capture.warning}</p>}
          {capture.direction !== "paper" && (
            <>
              <div className="coverage">
                <label>
                  Coverage
                  <select
                    aria-label="Capture coverage"
                    value={coverage}
                    onChange={(e) =>
                      setCoverage(e.target.value as typeof coverage)
                    }
                  >
                    <option value="unknown">Unknown completeness</option>
                    <option value="partial">Partial list</option>
                    <option value="complete">
                      Complete list, verified across all pages
                    </option>
                  </select>
                </label>
                <label>
                  Known total
                  <input
                    aria-label="Known source total"
                    type="number"
                    min={0}
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                  />
                </label>
              </div>
              {coverage === "complete" && capture.coverage !== "complete" && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={verifiedFull}
                    onChange={(e) => setVerifiedFull(e.target.checked)}
                  />
                  I verified that this capture includes the full list across all
                  pages.
                </label>
              )}
              <p>
                {chosen.size} selected / {items.length} captured · nothing is
                imported into the graph automatically.
              </p>
              <div className="entries">
                {items.map((p) => (
                  <label className="entry" key={p.id}>
                    <input
                      type="checkbox"
                      checked={chosen.has(p.id)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        setChosen(next);
                      }}
                    />
                    <span>
                      {p.title ||
                        p.doi ||
                        "Unidentified citation — raw text retained"}
                      <small>
                        {p.year ?? "Year unknown"} ·{" "}
                        {p.doi || p.ieee || "No exact identifier"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <details>
                <summary>Use an official BibTeX / RIS export instead</summary>
                <p>
                  Paste only citations from the current IEEE article section.
                  The focal identity and direction above remain authoritative.
                </p>
                <textarea
                  aria-label="Official citation export"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                />
                <button
                  onClick={() => {
                    try {
                      const parsed = parsePasted(raw);
                      setCapture({
                        ...capture,
                        method: "User-provided official BibTeX / RIS export",
                        warning:
                          "Official citation export parsed. Verify its focal paper, direction and completeness before confirming.",
                      });
                      setItems(parsed);
                      setChosen(new Set(parsed.map((p) => p.id)));
                      setCoverage("unknown");
                      setVerifiedFull(false);
                      setError("");
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Review exported entries
                </button>
              </details>
            </>
          )}
        </>
      )}
      {connectionError && (
        <p role="alert" className="error">
          {connectionError}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {status && (
        <p
          role="status"
          className={
            error
              ? "error"
              : busy || status.startsWith("Partially")
                ? "notice"
                : "success"
          }
        >
          {status}
        </p>
      )}
      <footer>
        <p>
          Only this active tab is read when you request it. No cookies or
          sign-in credentials are copied.
        </p>
        <button
          className="primary"
          disabled={busy || !capture || !workspace}
          onClick={() => void send()}
        >
          {busy
            ? "Working…"
            : capture?.direction === "paper"
              ? "Confirm paper import"
              : "Confirm IEEE capture"}
        </button>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
