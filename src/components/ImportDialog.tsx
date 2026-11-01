import { useState } from "react";
import { ArrowRight, ClipboardPaste } from "lucide-react";
import { Dialog } from "./Dialog";
import { PaperFields } from "./PaperForm";
import { parsePasted } from "../parsers";
import { duplicate, possibleDuplicate } from "../domain";
import { normalizeDoi } from "../domain";
import { labels, statuses } from "../types";
import type { Paper } from "../types";
export function ImportDialog({
  existing,
  anchor,
  onImport,
  onClose,
}: {
  existing: Paper[];
  anchor?: Paper;
  onImport: (p: Paper[], direction?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(""),
    [papers, setPapers] = useState<Paper[]>([]),
    [chosen, setChosen] = useState<Set<string>>(new Set()),
    [editing, setEditing] = useState<string | null>(null),
    [direction, setDirection] = useState("none"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const parse = () => {
    try {
      const parsed = parsePasted(raw);
      setPapers(parsed);
      setChosen(new Set(parsed.map((p) => p.id)));
      setEditing(parsed[0]?.id ?? null);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const current = papers.find((p) => p.id === editing);
  return (
    <Dialog
      title="Import from Pasted Text"
      description="BibTeX, RIS, DOI, IEEE citations, or copied metadata. Review every uncertain field."
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        {!papers.length ? (
          <>
            <div className="import-hint">
              <ClipboardPaste size={26} />
              <div>
                <b>Your sources, brought together</b>
                <p>
                  No AI, no invented metadata. Ambiguous information stays in
                  the original text.
                </p>
              </div>
            </div>
            <textarea
              aria-label="Pasted bibliographic text"
              className="paste-input"
              placeholder={
                "@article{example,\n  title = {Your paper title},\n  author = {Smith, Jane},\n  year = {2024},\n  doi = {10.1234/example}\n}"
              }
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </>
        ) : (
          <>
            <div className="import-table">
              {papers.map((p) => (
                <div key={p.id} className={editing === p.id ? "selected" : ""}>
                  <input
                    aria-label={`Import ${p.title || "untitled entry"}`}
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setChosen(next);
                    }}
                  />
                  <button
                    className="text-left"
                    onClick={() => setEditing(p.id)}
                  >
                    {p.title || "Title required — review this entry"}
                    <small>
                      {p.year ?? "Year unknown"} ·{" "}
                      {duplicate(p, existing)
                        ? "Already saved — preserve local edits"
                        : possibleDuplicate(p, existing)
                          ? "Possible title duplicate — review"
                          : "New paper"}
                    </small>
                  </button>
                  <select
                    aria-label="Import status"
                    value={p.status}
                    onChange={(e) =>
                      setPapers(
                        papers.map((q) =>
                          q.id === p.id
                            ? {
                                ...q,
                                status: e.target.value as Paper["status"],
                              }
                            : q,
                        ),
                      )
                    }
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {current && (
              <div className="import-editor">
                <h3>Review extracted metadata</h3>
                <PaperFields
                  paper={current}
                  onChange={(p) =>
                    setPapers(papers.map((q) => (q.id === p.id ? p : q)))
                  }
                />
                <details>
                  <summary>Preserved original input</summary>
                  <pre>{current.raw}</pre>
                </details>
              </div>
            )}
            {anchor && (
              <label className="field">
                Connect to “{anchor.title}”
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="none">
                    Import without a citation relationship
                  </option>
                  <option value="citing">
                    Imported papers cite the selected paper
                  </option>
                  <option value="references">
                    Selected paper cites the imported papers
                  </option>
                </select>
              </label>
            )}
            <p className="caption">
              {papers.length} detected entries. Blank titles must be corrected.
              Matching DOI / OpenAlex IDs reuse the existing record and preserve
              its notes and status.
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <button onClick={() => (papers.length ? setPapers([]) : onClose())}>
          {papers.length ? "Back to text" : "Cancel"}
        </button>
        {!papers.length ? (
          <button className="primary" onClick={parse}>
            Extract & review
            <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !chosen.size}
            onClick={async () => {
              setBusy(true);
              try {
                const selected = papers
                  .filter((p) => chosen.has(p.id))
                  .map((p) => ({ ...p, doi: normalizeDoi(p.doi) }));
                if (selected.some((p) => !p.title.trim()))
                  throw new Error("Enter a title for every selected entry.");
                await onImport(
                  selected,
                  direction === "none" ? undefined : direction,
                );
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Importing…" : `Import ${chosen.size} selected`}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
