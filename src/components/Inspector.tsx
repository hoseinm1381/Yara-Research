import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Pin,
  PinOff,
  ExternalLink,
  FileText,
  Focus,
  MoreHorizontal,
  Pencil,
  EyeOff,
  Trash2,
  X,
} from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { labels, statuses } from "../types";
import type { Paper, Snapshot } from "../types";
import { Notes } from "./Notes";
import { backend } from "../services/backend";
import type { DiscoveryMode } from "./Discovery";
import { confirmAction } from "../services/confirmation";
export function Inspector({
  paper,
  snapshot,
  onUpdate,
  onEdit,
  onExplore,
  onFocus,
  onHide,
  onDelete,
  onClose,
  notify,
  onDirty,
  onSelect,
}: {
  paper: Paper;
  snapshot: Snapshot;
  onUpdate: (p: Paper) => Promise<void>;
  onEdit: () => void;
  onExplore: (mode: DiscoveryMode) => void;
  onFocus: () => void;
  onHide: () => void;
  onDelete: () => void;
  onClose: () => void;
  notify: (s: string) => void;
  onDirty: (v: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<"details" | "notes" | "connections">(
    "details",
  );
  const [tags, setTags] = useState(paper.tags.join(", "));
  const [research, setResearch] = useState({ ...paper });
  const [noteDirty, setNoteDirty] = useState(false);
  const [assessmentDirty, setAssessmentDirty] = useState(false);
  const [metadataSources, setMetadataSources] = useState<
    { provider: string; url: string; capturedAt: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    void backend
      .call<{ provider: string; url: string; capturedAt: string }[]>(
        "metadata_sources",
        { id: paper.id },
      )
      .then((s) => {
        if (active) setMetadataSources(s);
      })
      .catch((e) => notify(String(e)));
    return () => {
      active = false;
    };
  }, [paper.id, notify]);
  const reportNoteDirty = useCallback((value: boolean) => {
    setNoteDirty(value);
  }, []);
  useEffect(() => {
    onDirty(noteDirty || assessmentDirty);
    return () => onDirty(false);
  }, [noteDirty, assessmentDirty, onDirty]);
  const incoming = snapshot.citations.filter((e) => e.cited === paper.id),
    outgoing = snapshot.citations.filter((e) => e.citing === paper.id);
  const update = async (p: Paper) => {
    try {
      await onUpdate(p);
      return true;
    } catch (e) {
      notify(String(e));
      return false;
    }
  };
  const changeTab = async (next: typeof tab) => {
    if (next !== tab) {
      if (
        noteDirty &&
        !(await confirmAction(
          "Discard unsaved note edits before changing tabs?",
        ))
      )
        return;
      setNoteDirty(false);
      setTab(next);
    }
  };
  return (
    <aside className="inspector">
      <div className="inspector-top">
        <span className="eyebrow">PAPER INSPECTOR</span>
        <div className="row">
          <Menu.Root>
            <Menu.Trigger asChild>
              <button className="icon-button" aria-label="Paper actions">
                <MoreHorizontal size={18} />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content className="context-menu" align="end">
                <Menu.Item onSelect={onEdit}>
                  <Pencil size={14} />
                  Edit metadata
                </Menu.Item>
                <Menu.Item
                  onSelect={() => void update({ ...paper, status: "core" })}
                >
                  Make Core
                </Menu.Item>
                <Menu.Item onSelect={onHide}>
                  <EyeOff size={14} />
                  Hide from canvas
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item className="red-text" onSelect={onDelete}>
                  <Trash2 size={14} />
                  Delete paper…
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
          <button
            className="icon-button"
            aria-label="Close inspector"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </div>
      <div className="inspector-title">
        <span className={`status-chip ${paper.status}`}>
          {labels[paper.status]}
        </span>
        <h2 dir="auto">{paper.title}</h2>
        <p>{paper.authors.join(", ") || "Authors not recorded"}</p>
        <div className="paper-meta">
          <b>{paper.year ?? "Year unknown"}</b>
          <span>{paper.journal || "Venue not recorded"}</span>
        </div>
        <div className="inspector-tools">
          <button
            onClick={() => void update({ ...paper, pinned: !paper.pinned })}
          >
            {paper.pinned ? <PinOff size={14} /> : <Pin size={14} />}{" "}
            {paper.pinned ? "Unpin" : "Pin position"}
          </button>
          <button onClick={onFocus}>
            <Focus size={14} />
            Focus
          </button>
          <button
            title="Open publication"
            disabled={!paper.url && !paper.doi}
            onClick={() =>
              void backend
                .call("open_url", {
                  url: paper.url || `https://doi.org/${paper.doi}`,
                })
                .catch((e) => notify(String(e)))
            }
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
      <div className="inspector-tabs">
        <button
          className={tab === "details" ? "active" : ""}
          onClick={() => changeTab("details")}
        >
          Overview
        </button>
        <button
          className={tab === "notes" ? "active" : ""}
          onClick={() => changeTab("notes")}
        >
          <FileText size={13} />
          Notes
        </button>
        <button
          className={tab === "connections" ? "active" : ""}
          onClick={() => changeTab("connections")}
        >
          Connections <span>{incoming.length + outgoing.length}</span>
        </button>
      </div>
      <div className="inspector-scroll">
        {tab === "notes" ? (
          <Notes
            key={paper.id}
            paper={paper}
            notify={notify}
            onDirty={reportNoteDirty}
          />
        ) : tab === "connections" ? (
          <>
            <div className="section-heading">Local graph connections</div>
            <p className="caption">
              These counts cover saved relationships only. Provider citation
              totals may differ.
            </p>
            {[
              [
                "Citing this paper",
                incoming.map((e) => ({ id: e.citing, edge: e })),
              ],
              [
                "Referenced by this paper",
                outgoing.map((e) => ({ id: e.cited, edge: e })),
              ],
            ].map(([title, items]) => (
              <div className="connections-group" key={String(title)}>
                <h3>{String(title)}</h3>
                {(
                  items as { id: string; edge: Snapshot["citations"][number] }[]
                ).map(({ id, edge }) => (
                  <div className="connection-row" key={id}>
                    <button onClick={() => onSelect(id)}>
                      {snapshot.papers.find((p) => p.id === id)?.title}
                      <small>
                        {edge.verified
                          ? "Imported · verified relationship"
                          : "Manually added relationship"}
                      </small>
                    </button>
                    <button
                      title="Remove citation"
                      onClick={async () => {
                        if (
                          await confirmAction(
                            "Remove this citation connection? Both papers and notes will remain.",
                          )
                        )
                          void backend
                            .call("delete_citation", {
                              citing: edge.citing,
                              cited: edge.cited,
                            })
                            .then(() => onUpdate(paper))
                            .catch((e) => notify(String(e)));
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                {!(items as unknown[]).length && (
                  <p className="muted">No locally known relationships.</p>
                )}
              </div>
            ))}
            <p className="caption">
              Last discovery:{" "}
              {paper.lastDiscovery
                ? new Date(paper.lastDiscovery).toLocaleString()
                : "Not yet explored"}
              <br />
              More remote results may exist. OpenAlex coverage is incomplete.
            </p>
          </>
        ) : (
          <>
            <section>
              <h3>Research status</h3>
              <select
                aria-label="Paper status"
                className={`status-select ${paper.status}`}
                value={paper.status}
                onChange={(e) =>
                  void update({
                    ...paper,
                    status: e.target.value as Paper["status"],
                  })
                }
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {labels[s]}
                  </option>
                ))}
              </select>
              <label className="field">
                Tags
                <input
                  aria-label="Paper tags"
                  value={tags}
                  placeholder="methods, background, follow-up"
                  onChange={(e) => setTags(e.target.value)}
                  onBlur={() => {
                    const next = tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean);
                    if (next.join(",") !== paper.tags.join(","))
                      void update({ ...paper, tags: next });
                  }}
                />
              </label>
            </section>
            <section className="explore-section">
              <h3>Follow the research</h3>
              <button
                aria-label="Find Citing Papers"
                onClick={() => onExplore("citing")}
              >
                <span className="action-icon">
                  <ArrowUpRight size={17} />
                </span>
                <span>
                  <b>Find Citing Papers</b>
                  <small>Where this research led</small>
                </span>
                <span className="muted">→</span>
              </button>
              <button
                aria-label="Find Referenced Papers"
                onClick={() => onExplore("references")}
              >
                <span className="action-icon">
                  <ArrowDownLeft size={17} />
                </span>
                <span>
                  <b>Find Referenced Papers</b>
                  <small>What this work builds on</small>
                </span>
                <span className="muted">→</span>
              </button>
              <button className="text-link" onClick={() => onExplore("both")}>
                Explore both directions
              </button>
            </section>
            <section>
              <h3>Abstract</h3>
              <p className="abstract" dir="auto">
                {paper.abstract ||
                  "No abstract recorded. Add one through Edit metadata or consult the original publication."}
              </p>
            </section>
            <section>
              <h3>Research assessment</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const saved = await update({
                    ...paper,
                    ...Object.fromEntries(
                      [
                        "summary",
                        "findings",
                        "strengths",
                        "weaknesses",
                        "relevance",
                        "tasks",
                      ].map((k) => [k, research[k as keyof Paper]]),
                    ),
                  });
                  if (saved) {
                    notify("Research assessment saved");
                    setAssessmentDirty(false);
                  }
                }}
              >
                {(
                  [
                    ["summary", "Personal summary"],
                    ["findings", "Important findings"],
                    ["strengths", "Strengths"],
                    ["weaknesses", "Weaknesses"],
                    ["relevance", "Research relevance"],
                    ["tasks", "Follow-up tasks"],
                  ] as const
                ).map(([k, title]) => (
                  <label className="field" key={k}>
                    {title}
                    <textarea
                      value={research[k]}
                      onChange={(e) => {
                        setResearch({ ...research, [k]: e.target.value });
                        setAssessmentDirty(true);
                      }}
                    />
                  </label>
                ))}
                <button type="submit">Save assessment</button>
              </form>
            </section>
            <section>
              <h3>Publication record</h3>
              {metadataSources.length > 0 && (
                <details>
                  <summary>Metadata sources</summary>
                  {metadataSources.map((s) => (
                    <p className="caption" key={`${s.provider}-${s.url}`}>
                      {s.provider} · {new Date(s.capturedAt).toLocaleString()}
                      <br />
                      {s.url || "Local corrections"}
                      <br />
                      Metadata provenance does not establish a citation
                      relationship.
                    </p>
                  ))}
                </details>
              )}
              <dl>
                <dt>DOI</dt>
                <dd>{paper.doi || "Not recorded"}</dd>
                <dt>OpenAlex</dt>
                <dd>{paper.openalex || "Not linked"}</dd>
                <dt>Published</dt>
                <dd>{paper.publicationDate || paper.year || "Not recorded"}</dd>
                <dt>Publisher</dt>
                <dd>{paper.publisher || "Not recorded"}</dd>
                <dt>Keywords / index terms</dt>
                <dd dir="auto">
                  {paper.keywords.length
                    ? paper.keywords.join(" · ")
                    : "Not recorded"}
                </dd>
                <dt>Provider citations</dt>
                <dd>{paper.citationCount ?? "Unavailable"}</dd>
                <dt>Source</dt>
                <dd>{paper.source}</dd>
                <dt>Added</dt>
                <dd>{new Date(paper.createdAt).toLocaleDateString()}</dd>
                <dt>Updated</dt>
                <dd>{new Date(paper.updatedAt).toLocaleDateString()}</dd>
              </dl>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
