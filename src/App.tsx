import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection } from "@xyflow/react";
import {
  Search,
  Plus,
  Network,
  ChevronDown,
  ClipboardPaste,
  SlidersHorizontal,
  Link2,
  ArrowRight,
  PanelRightClose,
  Layers,
  CheckCircle2,
  RotateCcw,
  X,
  FileText,
  FolderOpen,
} from "lucide-react";
import { backend, desktop } from "./services/backend";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { ResizableInspector } from "./components/ResizableInspector";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Graph } from "./components/Graph";
import { Inspector } from "./components/Inspector";
import { PaperForm } from "./components/PaperForm";
import { ImportDialog } from "./components/ImportDialog";
import { Discovery } from "./components/Discovery";
import type { DiscoveryMode } from "./components/Discovery";
import { Settings } from "./components/Settings";
import { Dialog, Confirm } from "./components/Dialog";
import { newPaper, labels, statuses } from "./types";
import type { Paper, Snapshot } from "./types";
import { filterPapers, matches, placeNew } from "./domain";
import type { Filters } from "./domain";
import { demoData } from "./demo";
import { confirmAction } from "./services/confirmation";
type Modal =
  | { type: "paper"; paper: Paper }
  | { type: "paste" }
  | { type: "discovery"; mode: DiscoveryMode; anchor?: Paper }
  | { type: "settings" }
  | { type: "connect"; citing: string; cited: string }
  | { type: "delete"; paper: Paper }
  | { type: "layout" }
  | null;
const initialFilters: Filters = {
  search: "",
  status: "all",
  tag: "",
  from: "",
  to: "",
  hideArchived: false,
};
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [startupError, setStartupError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [coreId, setCoreId] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [inspectorWidth, setInspectorWidth] = useState(344),
    [modal, setModal] = useState<Modal>(null),
    [filters, setFilters] = useState(initialFilters),
    [search, setSearch] = useState(""),
    [showFilters, setShowFilters] = useState(false),
    [theme, setTheme] = useState("dark"),
    [toast, setToast] = useState(""),
    [dirty, setDirty] = useState(false),
    [view, setView] = useState<"graph" | "library">("graph"),
    [hiddenVisible, setHiddenVisible] = useState(false);
  const [initialViewport, setInitialViewport] = useState<
    { x: number; y: number; zoom: number } | undefined
  >(undefined);
  const graphRef = useRef<import("./components/Graph").GraphHandle>(null);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = useCallback((message: string) => setToast(message), []);
  const reload = useCallback(async () => {
    const next = await backend.snapshot();
    setSnapshot(next);
    return next;
  }, []);
  useEffect(() => {
    void backend
      .snapshot()
      .then((s) => {
        setSnapshot(s);
        setTheme(s.settings.theme || "dark");
        setCollapsed(s.settings.sidebarCollapsed === "true");
        setInspectorWidth(Number(s.settings.inspectorWidth) || 344);
        try {
          setInitialViewport(
            JSON.parse(s.settings.viewport || "null") || undefined,
          );
        } catch {
          setInitialViewport(undefined);
        }
      })
      .catch((e) => setStartupError(String(e)));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  const canLeave = useCallback(
    async () =>
      !dirty ||
      (await confirmAction(
        "You have unsaved note or assessment edits. Discard them and continue?",
      )),
    [dirty],
  );
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const unlisten = await getCurrentWindow().onCloseRequested(async (e) => {
        if (dirty) {
          e.preventDefault();
          if (await canLeave()) await getCurrentWindow().destroy();
        }
      });
      if (disposed) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [canLeave, dirty]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("local-search")?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        setModal({ type: "paper", paper: newPaper() });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const update = useCallback(
    async (p: Paper) => {
      await backend.save(p);
      await reload();
    },
    [reload],
  );
  const select = useCallback(
    async (id: string) => {
      if (id === selected) return;
      if (id !== selected && !(await canLeave())) return;
      setDirty(false);
      setSelected(id);
      setView("graph");
      setFilters(initialFilters);
      const p = snapshot?.papers.find((p) => p.id === id);
      if (p?.hidden)
        void update({ ...p, hidden: false }).catch((e) => notify(String(e)));
    },
    [selected, canLeave, snapshot, update, notify],
  );
  const explore = useCallback(
    (id: string) => {
      const anchor = snapshot?.papers.find((p) => p.id === id);
      if (anchor) setModal({ type: "discovery", mode: "both", anchor });
    },
    [snapshot],
  );
  const position = useCallback(
    (id: string, x: number, y: number) => {
      setSnapshot((s) =>
        s
          ? {
              ...s,
              papers: s.papers.map((p) => (p.id === id ? { ...p, x, y } : p)),
            }
          : s,
      );
      void backend.call("save_position", { id, x, y }).catch((e) => {
        notify(String(e));
        void reload();
      });
    },
    [notify, reload],
  );
  const saveViewport = useCallback(
    (v: { x: number; y: number; zoom: number }) => {
      clearTimeout(viewportTimer.current);
      viewportTimer.current = setTimeout(
        () =>
          void backend
            .call("set_setting", { key: "viewport", value: JSON.stringify(v) })
            .catch((e) => notify(String(e))),
        400,
      );
    },
    [notify],
  );
  const connect = useCallback((c: Connection) => {
    if (c.source && c.target)
      setModal({ type: "connect", citing: c.source, cited: c.target });
  }, []);
  const papers = useMemo(() => snapshot?.papers ?? [], [snapshot]);
  const paper = papers.find((p) => p.id === selected);
  const visible = useMemo(
    () =>
      filterPapers(
        hiddenVisible ? papers.map((p) => ({ ...p, hidden: false })) : papers,
        filters,
      ),
    [papers, filters, hiddenVisible],
  );
  const allTags = useMemo(
    () => [...new Set(papers.flatMap((p) => p.tags))].sort(),
    [papers],
  );
  const matchesSearch = useMemo(
    () =>
      papers
        .filter((p) => matches(p, search))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 60),
    [papers, search],
  );
  async function importPapers(
    incoming: Paper[],
    anchor?: Paper,
    direction?: string,
  ) {
    if (!(await canLeave()))
      throw new Error("Import canceled to preserve unsaved edits.");
    const placed = placeNew(
      papers,
      incoming,
      anchor,
      direction === "references" ? "references" : "citing",
    );
    const prepared = incoming.map((p, i) => ({
      ...p,
      x: placed[i].x,
      y: placed[i].y,
    }));
    const added = await backend.import(prepared, anchor?.id, direction);
    if (anchor) {
      await backend.save({
        ...anchor,
        lastDiscovery: new Date().toISOString(),
      });
    }
    await reload();
    notify(
      `${added.length} paper${added.length === 1 ? "" : "s"} added or connected`,
    );
    if (added[0]) {
      setSelected(added[0].id);
    }
  }
  async function loadDemo() {
    const demo = demoData();
    const added = await backend.import(demo.papers);
    for (const [from, to] of demo.edges)
      await backend.call("save_citation", {
        citing: added[from].id,
        cited: added[to].id,
      });
    await backend.saveNote(
      added[0].id,
      "# Attention Is All You Need\n\n## Personal Summary\n\nDemo note: a foundation for exploring transformer architectures.\n\n## Follow-Up Notes\n\n- [ ] Compare attention mechanisms\n- [ ] Review BERT pretraining\n",
      (await backend.readNote(added[0].id)).revision,
    );
    await reload();
    setSelected(added[0].id);
    notify("Demonstration loaded · all records are marked as demo data");
  }
  const saveInspectorWidth = useCallback(
    (width: number) => {
      setInspectorWidth(width);
      void backend
        .call("set_setting", { key: "inspectorWidth", value: String(width) })
        .catch((e) => notify(String(e)));
    },
    [notify],
  );
  async function switchWorkspace(id: string) {
    if (!(await canLeave())) return;
    clearTimeout(viewportTimer.current);
    const next = await backend.call<Snapshot>("switch_workspace", { id });
    setSelected(null);
    setDirty(false);
    setModal(null);
    setCoreId("");
    setFilters(initialFilters);
    setSnapshot(next);
    setTheme(next.settings.theme || "dark");
    setCollapsed(next.settings.sidebarCollapsed === "true");
    setInspectorWidth(Number(next.settings.inspectorWidth) || 344);
    try {
      setInitialViewport(
        JSON.parse(next.settings.viewport || "null") || undefined,
      );
    } catch {
      setInitialViewport(undefined);
    }
  }
  useEffect(() => {
    let last = "";
    let disposed = false;
    const poll = async () => {
      try {
        const rev = await backend.call<string>("workspace_revision");
        if (last && last !== rev && !disposed) await reload();
        last = rev;
      } catch (e) {
        if (!disposed) notify(String(e));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [reload, notify]);
  if (!snapshot)
    return (
      <div className="boot">
        <img src="/app-icon.svg" alt="" />
        <h1>Yara Research</h1>
        <p>{startupError || "Opening your local workspace…"}</p>
        {startupError && (
          <button onClick={() => window.location.reload()}>
            Retry opening workspace
          </button>
        )}
      </div>
    );
  const activeFilters =
    filters.tag || filters.from || filters.to || filters.hideArchived;
  return (
    <div className="application">
      <WorkspaceSidebar
        snapshot={snapshot}
        view={view}
        filters={filters}
        theme={theme}
        collapsed={collapsed}
        onCollapse={() => {
          const next = !collapsed;
          setCollapsed(next);
          void backend
            .call("set_setting", {
              key: "sidebarCollapsed",
              value: String(next),
            })
            .catch((e) => notify(String(e)));
        }}
        onNavigate={(v, status, tag = "") => {
          setView(v);
          setFilters({ ...initialFilters, status, tag });
        }}
        onSettings={() => {
          void canLeave().then((ok) => {
            if (ok) setModal({ type: "settings" });
          });
        }}
        onTheme={() => {
          const next = theme === "dark" ? "light" : "dark";
          setTheme(next);
          void backend
            .call("set_setting", { key: "theme", value: next })
            .catch((e) => notify(String(e)));
        }}
        onSwitch={switchWorkspace}
        onChanged={async () => {
          await reload();
        }}
      />
      <main className="main">
        <header className="topbar">
          <div className="global-search">
            <Search size={15} />
            <input
              id="local-search"
              aria-label="Search local papers"
              placeholder="Search your papers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>Ctrl K</kbd>
            {search && (
              <div className="search-results">
                {matchesSearch.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      select(p.id);
                      setSearch("");
                    }}
                  >
                    <span className={`status-dot ${p.status}`} />
                    <div>
                      {p.title}
                      <small>
                        {p.year ?? "Unknown year"} ·{" "}
                        {p.authors[0] || "Author unknown"}
                        {p.hidden ? " · hidden" : ""}
                      </small>
                    </div>
                  </button>
                ))}
                {!matchesSearch.length && <p>No saved papers match.</p>}
              </div>
            )}
          </div>
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                className="primary"
                aria-label="Add Paper"
                aria-haspopup="menu"
              >
                <Plus size={16} />
                Add Paper
                <ChevronDown size={13} />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="context-menu add-paper-menu"
                align="end"
                collisionPadding={8}
              >
                <Menu.Item
                  onSelect={() =>
                    setModal({
                      type: "paper",
                      paper: newPaper({
                        x: (papers.length % 4) * 380,
                        y: Math.floor(papers.length / 4) * 210,
                      }),
                    })
                  }
                >
                  <Plus size={15} />
                  Add Paper Manually
                </Menu.Item>
                <Menu.Item
                  onSelect={() =>
                    setModal({ type: "discovery", mode: "search" })
                  }
                >
                  <Search size={15} />
                  Discover Papers
                </Menu.Item>
                <Menu.Item onSelect={() => setModal({ type: "paste" })}>
                  <ClipboardPaste size={15} />
                  Import from Text
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </header>
        <div className="workspace-body">
          <div className="canvas-column">
            <div className="canvas-toolbar">
              <div className="row">
                <span className="toolbar-label">
                  <Network size={15} />
                  {view === "graph" ? "Graph canvas" : "Library"}
                </span>
                <span className="divider" />
                <select
                  aria-label="Focal core paper"
                  value={
                    papers.some((p) => p.id === coreId && p.status === "core")
                      ? coreId
                      : ""
                  }
                  onChange={(e) => {
                    setCoreId(e.target.value);
                    if (e.target.value) void select(e.target.value);
                  }}
                >
                  <option value="">Select a core paper</option>
                  {papers
                    .filter((p) => p.status === "core")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="row">
                <button
                  className={activeFilters ? "active" : ""}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <SlidersHorizontal size={14} />
                  Filters{activeFilters && <span className="tiny-dot" />}
                </button>
                <button
                  title="Add citation connection"
                  disabled={papers.length < 2}
                  onClick={() =>
                    setModal({
                      type: "connect",
                      citing: paper?.id || papers[0].id,
                      cited:
                        papers.find((p) => p.id !== paper?.id)?.id ||
                        papers[1].id,
                    })
                  }
                >
                  <Link2 size={15} />
                </button>
                <button
                  title="Reorganize unpinned nodes"
                  disabled={!papers.length}
                  onClick={() => setModal({ type: "layout" })}
                >
                  <Layers size={15} />
                </button>
                {paper && (
                  <button
                    title="Close inspector"
                    onClick={async () => {
                      if (await canLeave()) {
                        setSelected(null);
                        setDirty(false);
                      }
                    }}
                  >
                    <PanelRightClose size={15} />
                  </button>
                )}
              </div>
            </div>
            {showFilters && (
              <div className="filter-bar">
                <select
                  aria-label="Filter status"
                  value={filters.status}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      status: e.target.value as Filters["status"],
                    })
                  }
                >
                  <option value="all">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {labels[s]}
                    </option>
                  ))}
                  <option value="notes">With notes</option>
                </select>
                <select
                  aria-label="Filter tag"
                  value={filters.tag}
                  onChange={(e) =>
                    setFilters({ ...filters, tag: e.target.value })
                  }
                >
                  <option value="">All tags</option>
                  {allTags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <input
                  aria-label="From year"
                  type="number"
                  placeholder="From year"
                  value={filters.from}
                  onChange={(e) =>
                    setFilters({ ...filters, from: e.target.value })
                  }
                />
                <input
                  aria-label="To year"
                  type="number"
                  placeholder="To year"
                  value={filters.to}
                  onChange={(e) =>
                    setFilters({ ...filters, to: e.target.value })
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={filters.hideArchived}
                    onChange={(e) =>
                      setFilters({ ...filters, hideArchived: e.target.checked })
                    }
                  />
                  Hide archived
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={hiddenVisible}
                    onChange={(e) => setHiddenVisible(e.target.checked)}
                  />
                  Reveal hidden
                </label>
                <button
                  title="Reset filters"
                  onClick={() => {
                    setFilters(initialFilters);
                    setHiddenVisible(false);
                  }}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            )}
            <div className="canvas-content">
              <div
                className="graph-stage"
                style={{
                  visibility:
                    papers.length && view === "graph" ? "visible" : "hidden",
                }}
              >
                {" "}
                <Graph
                  key={snapshot.workspace.id}
                  ref={graphRef}
                  papers={visible}
                  citations={snapshot.citations}
                  selected={selected}
                  onSelect={select}
                  onExplore={explore}
                  onUpdate={async (p) => {
                    try {
                      await update(p);
                    } catch (e) {
                      notify(String(e));
                    }
                  }}
                  onPosition={position}
                  onConnect={connect}
                  onViewport={saveViewport}
                  viewport={initialViewport}
                  theme={theme}
                />
              </div>
              {!papers.length ? (
                <div className="empty-canvas">
                  <div className="empty-illustration">
                    <span />
                    <span />
                    <span />
                    <Network size={45} />
                  </div>
                  <span className="eyebrow">
                    EVERY DISCOVERY STARTS SOMEWHERE
                  </span>
                  <h2>
                    Start with one paper.
                    <br />
                    See where it takes you.
                  </h2>
                  <p>
                    Map the research behind your next idea.
                    <br />
                    Add a paper, follow its citations, and make the connections
                    yours.
                  </p>
                  <div className="row">
                    <button
                      className="primary"
                      onClick={() =>
                        setModal({
                          type: "paper",
                          paper: newPaper({ status: "core" }),
                        })
                      }
                    >
                      <Plus size={16} />
                      Add your first paper
                    </button>
                    <button
                      onClick={() =>
                        setModal({ type: "discovery", mode: "search" })
                      }
                    >
                      <Search size={16} />
                      Search literature
                    </button>
                  </div>
                  <button
                    className="text-link demo-link"
                    onClick={() =>
                      void loadDemo().catch((e) => notify(String(e)))
                    }
                  >
                    Or explore a demonstration graph
                    <ArrowRight size={13} />
                  </button>
                  <div className="empty-features">
                    <span>
                      <FolderOpen size={14} />
                      Local & private
                    </span>
                    <span>
                      <Network size={14} />
                      Connected thinking
                    </span>
                    <span>
                      <FileText size={14} />
                      Markdown notes
                    </span>
                  </div>
                </div>
              ) : view === "library" ? (
                <div className="library">
                  <div className="library-head">
                    <span>Title & author</span>
                    <span>Year</span>
                    <span>Status</span>
                  </div>
                  {papers
                    .filter((p) => matches(p, search))
                    .map((p) => (
                      <div key={p.id} className="library-row">
                        <button onClick={() => select(p.id)}>
                          <span className={`status-dot ${p.status}`} />
                          <div>
                            {p.title}
                            <small>
                              {p.authors.join(", ") || "Author not recorded"} ·{" "}
                              {p.tags.join(", ")}
                            </small>
                          </div>
                        </button>
                        <span>{p.year ?? "—"}</span>
                        <select
                          aria-label={`Library status ${p.title}`}
                          value={p.status}
                          onChange={(e) =>
                            void update({
                              ...p,
                              status: e.target.value as Paper["status"],
                            }).catch((e) => notify(String(e)))
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
              ) : (
                <>
                  {!visible.length && (
                    <div className="filtered-empty">
                      No papers match these filters.
                      <button
                        onClick={() => {
                          setFilters(initialFilters);
                          setHiddenVisible(true);
                        }}
                      >
                        Show all papers
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            <footer className="canvas-footer">
              <div className="legend">
                {statuses.map((s) => (
                  <span key={s}>
                    <i className={`status-dot ${s}`} />
                    {labels[s]}
                  </span>
                ))}
              </div>
              <span>
                {visible.length} visible{" "}
                <span className="muted">/ {papers.length} saved</span>
              </span>
            </footer>
          </div>
          {paper && (
            <ResizableInspector
              savedWidth={inspectorWidth}
              onSave={saveInspectorWidth}
            >
              <Inspector
                key={paper.id}
                paper={paper}
                snapshot={snapshot}
                onUpdate={update}
                onEdit={() => setModal({ type: "paper", paper })}
                onExplore={(mode) =>
                  setModal({ type: "discovery", mode, anchor: paper })
                }
                onFocus={() => graphRef.current?.focus(paper.id)}
                onHide={async () => {
                  if (await canLeave())
                    void update({ ...paper, hidden: true })
                      .then(() => setSelected(null))
                      .catch((e) => notify(String(e)));
                }}
                onDelete={() => setModal({ type: "delete", paper })}
                onClose={async () => {
                  if (await canLeave()) {
                    setSelected(null);
                    setDirty(false);
                  }
                }}
                notify={notify}
                onDirty={setDirty}
                onSelect={select}
              />
            </ResizableInspector>
          )}
        </div>
        <footer className="statusbar">
          <span>
            <span className="tiny-dot" />{" "}
            {desktop
              ? "SQLite workspace · stored on this device"
              : "Browser preview · separate local browser data"}
          </span>
          <span>
            Yara Research <span className="muted">1.1.1</span>
          </span>
        </footer>
      </main>
      {modal?.type === "paper" && (
        <PaperForm
          initial={modal.paper}
          existing={papers}
          onClose={() => setModal(null)}
          onSave={async (p) => {
            if (p.id !== selected && !(await canLeave()))
              throw new Error(
                "Save your existing note edits before switching to a different paper.",
              );
            await update(p);
            setSelected(p.id);
            notify("Paper saved locally");
          }}
        />
      )}
      {modal?.type === "paste" && (
        <ImportDialog
          existing={papers}
          anchor={paper}
          onImport={(p, d) => importPapers(p, paper, d)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "discovery" && (
        <Discovery
          key={`${modal.mode}-${modal.anchor?.id}`}
          mode={modal.mode}
          anchor={modal.anchor}
          existing={papers}
          onImport={(p, d) => importPapers(p, modal.anchor, d)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "settings" && (
        <Settings
          snapshot={snapshot}
          onClose={() => setModal(null)}
          notify={notify}
          reload={async () => {
            await reload();
            setSelected(null);
          }}
          onDemo={loadDemo}
        />
      )}
      {modal?.type === "connect" && (
        <Dialog
          title="Add a citation connection"
          description="Citation arrows always point from the citing paper to the cited paper."
          onClose={() => setModal(null)}
        >
          <div className="dialog-body connection-form">
            <label>
              Citing paper
              <select
                aria-label="Citing paper"
                value={modal.citing}
                onChange={(e) => setModal({ ...modal, citing: e.target.value })}
              >
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="cites-label">↓ cites ↓</div>
            <label>
              Cited paper
              <select
                aria-label="Cited paper"
                value={modal.cited}
                onChange={(e) => setModal({ ...modal, cited: e.target.value })}
              >
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="caption">
              This connection will be marked as manually created. Confirm the
              direction before adding.
            </p>
          </div>
          <footer className="dialog-footer">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button
              className="primary"
              disabled={modal.citing === modal.cited}
              onClick={() =>
                void backend
                  .call("save_citation", {
                    citing: modal.citing,
                    cited: modal.cited,
                  })
                  .then(reload)
                  .then(() => {
                    setModal(null);
                    notify("Manual citation added");
                  })
                  .catch((e) => notify(String(e)))
              }
            >
              Confirm connection
            </button>
          </footer>
        </Dialog>
      )}
      {modal?.type === "delete" && (
        <Confirm
          title="Delete this paper?"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            if (!(await canLeave())) return;
            await backend.call("delete_paper", { id: modal.paper.id });
            setSelected(null);
            setModal(null);
            setDirty(false);
            await reload();
            notify(
              "Paper deleted. Its Markdown file remains in the notes folder for recovery.",
            );
          }}
        >
          “{modal.paper.title}” and its citation connections will be removed
          from the database. Its Markdown file is retained for recovery. To keep
          the record, use Hide or Archived instead.
        </Confirm>
      )}
      {modal?.type === "layout" && (
        <Dialog
          title="Organize the canvas"
          description="These actions change saved coordinates. Pinned papers keep their positions."
          onClose={() => setModal(null)}
        >
          <div className="dialog-body">
            <p>
              Choose a deliberate layout change. All other graph interactions
              preserve your saved positions.
            </p>
            <button
              onClick={async () => {
                try {
                  const fixed = papers.filter((p) => p.pinned);
                  const moving = papers.filter((p) => !p.pinned);
                  const layout = placeNew(
                    fixed,
                    moving.map((p) => ({ ...p, id: crypto.randomUUID() })),
                  );
                  for (let i = 0; i < moving.length; i++)
                    await backend.call("save_position", {
                      id: moving[i].id,
                      x: layout[i].x,
                      y: layout[i].y,
                    });
                  await reload();
                  setModal(null);
                } catch (e) {
                  notify(String(e));
                  await reload();
                }
              }}
            >
              Reorganize unpinned papers
            </button>
            <button
              onClick={async () => {
                try {
                  const archived = papers.filter(
                    (p) => p.status === "archived" && !p.pinned,
                  );
                  const bottom = Math.max(0, ...papers.map((p) => p.y)) + 300;
                  for (let i = 0; i < archived.length; i++)
                    await backend.call("save_position", {
                      id: archived[i].id,
                      x: (i % 3) * 390,
                      y: bottom + Math.floor(i / 3) * 210,
                    });
                  await reload();
                  setModal(null);
                } catch (e) {
                  notify(String(e));
                  await reload();
                }
              }}
            >
              Move unpinned archived papers to a separate area
            </button>
          </div>
        </Dialog>
      )}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
export function Root() {
  return <App />;
}
