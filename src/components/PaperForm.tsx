import { useState } from "react";
import { Dialog } from "./Dialog";
import { labels, statuses } from "../types";
import type { Paper } from "../types";
import { normalizeDoi, possibleDuplicate } from "../domain";
import { confirmAction } from "../services/confirmation";
export function PaperFields({
  paper,
  onChange,
}: {
  paper: Paper;
  onChange: (p: Paper) => void;
}) {
  const field = (key: keyof Paper, label: string, area = false) => (
    <label>
      {label}
      {area ? (
        <textarea
          value={String(paper[key] ?? "")}
          onChange={(e) => onChange({ ...paper, [key]: e.target.value })}
        />
      ) : (
        <input
          value={String(paper[key] ?? "")}
          onChange={(e) => onChange({ ...paper, [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <div className="form-grid">
      <label className="span-2">
        Paper title <span className="muted">required</span>
        <input
          required
          autoFocus
          value={paper.title}
          onChange={(e) => onChange({ ...paper, title: e.target.value })}
          placeholder="What are you researching?"
        />
      </label>
      <label className="span-2">
        Authors <span className="muted">separate with semicolons</span>
        <input
          value={paper.authors.join("; ")}
          onChange={(e) =>
            onChange({ ...paper, authors: e.target.value.split(";") })
          }
        />
      </label>
      <label>
        Publication year
        <input
          type="number"
          min={1000}
          max={2200}
          value={paper.year ?? ""}
          onChange={(e) =>
            onChange({
              ...paper,
              year: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </label>
      <label>
        Status
        <select
          value={paper.status}
          onChange={(e) =>
            onChange({ ...paper, status: e.target.value as Paper["status"] })
          }
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {labels[s]}
            </option>
          ))}
        </select>
      </label>
      {field("doi", "DOI")}
      {field("openalex", "OpenAlex work ID")}
      {field("journal", "Journal / conference")}
      {field("publisher", "Publisher")}
      {field("publicationDate", "Publication date")}
      {field("url", "Publication URL")}
      <label>
        Tags <span className="muted">comma separated</span>
        <input
          value={paper.tags.join(",")}
          onChange={(e) =>
            onChange({ ...paper, tags: e.target.value.split(",") })
          }
        />
      </label>
      <label>
        Keywords
        <input
          value={paper.keywords.join(",")}
          onChange={(e) =>
            onChange({ ...paper, keywords: e.target.value.split(",") })
          }
        />
      </label>
      <div className="span-2">{field("abstract", "Abstract", true)}</div>
      <div className="span-2">
        {field("summary", "Personal summary / initial notes", true)}
      </div>
      <label className="span-2">
        Known reference OpenAlex IDs{" "}
        <span className="muted">
          one per line; connects matching saved papers
        </span>
        <textarea
          value={paper.references.join("\n")}
          onChange={(e) =>
            onChange({
              ...paper,
              references: e.target.value.split("\n").filter(Boolean),
              source:
                paper.source === "OpenAlex"
                  ? "OpenAlex · references edited manually"
                  : paper.source,
            })
          }
        />
      </label>
    </div>
  );
}
export function PaperForm({
  initial,
  existing,
  onSave,
  onClose,
}: {
  initial: Paper;
  existing: Paper[];
  onSave: (p: Paper) => Promise<void>;
  onClose: () => void;
}) {
  const [p, setP] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const suggestion = possibleDuplicate(p, existing);
  const close = async () => {
    if (
      JSON.stringify(p) === JSON.stringify(initial) ||
      (await confirmAction("Discard unsaved metadata edits?"))
    )
      onClose();
  };
  return (
    <Dialog
      title={existing.some((q) => q.id === p.id) ? "Edit paper" : "Add a paper"}
      description="Start with what you know. You can complete the metadata later."
      onClose={close}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              ...p,
              title: p.title.trim(),
              doi: normalizeDoi(p.doi),
              authors: p.authors.map((a) => a.trim()).filter(Boolean),
              tags: p.tags.map((t) => t.trim()).filter(Boolean),
              keywords: p.keywords.map((t) => t.trim()).filter(Boolean),
            });
            onClose();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body">
          <PaperFields paper={p} onChange={setP} />
          {suggestion && (
            <p className="notice">
              Possible duplicate: “{suggestion.title}”. Review identifiers
              before creating a separate record; ambiguous titles are never
              merged automatically.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !p.title.trim()}>
            {busy ? "Saving…" : "Save paper"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
