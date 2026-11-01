import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Network,
  BookOpen,
  Star,
  Bookmark,
  Archive,
  Settings2,
  Sun,
  Moon,
  ChevronDown,
  CheckCircle2,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Tags,
  FolderOpen,
  Plus,
  Pencil,
} from "lucide-react";
import { Dialog } from "./Dialog";
import { backend, desktop } from "../services/backend";
import { labels } from "../types";
import type { Snapshot, Workspace } from "../types";
import type { Filters } from "../domain";
export function WorkspaceSidebar({
  snapshot,
  view,
  filters,
  onNavigate,
  onSettings,
  onTheme,
  theme,
  collapsed,
  onCollapse,
  onSwitch,
  onChanged,
}: {
  snapshot: Snapshot;
  view: "graph" | "library";
  filters: Filters;
  onNavigate: (
    view: "graph" | "library",
    status: Filters["status"],
    tag?: string,
  ) => void;
  onSettings: () => void;
  onTheme: () => void;
  theme: string;
  collapsed: boolean;
  onCollapse: () => void;
  onSwitch: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [edit, setEdit] = useState<"create" | "rename" | null>(null),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const papers = snapshot.papers;
  const allTags = [...new Set(papers.flatMap((p) => p.tags))].sort();
  const tags = allTags.map((t) => (
    <Menu.Item key={t} onSelect={() => onNavigate("graph", "all", t)}>
      #{t}
    </Menu.Item>
  ));
  const workspaceMenu = (
    <Menu.Root
      onOpenChange={(open) => {
        if (open)
          void backend
            .call<Workspace[]>("list_workspaces")
            .then(setWorkspaces)
            .catch((e) => setError(String(e)));
      }}
    >
      <Menu.Trigger asChild>
        <button
          className="workspace-select"
          aria-label="Choose workspace"
          title={snapshot.workspace.name}
        >
          <FolderOpen size={17} />
          <span>
            {snapshot.workspace.name}
            <small>Local workspace</small>
          </span>
          <ChevronDown size={13} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="context-menu workspace-menu"
          side={collapsed ? "right" : "bottom"}
          align="start"
          collisionPadding={8}
        >
          {workspaces.map((w) => (
            <Menu.Item
              key={w.id}
              onSelect={() =>
                void onSwitch(w.id).catch((e) => setError(String(e)))
              }
            >
              {w.active ? <CheckCircle2 size={14} /> : <FolderOpen size={14} />}
              <span>
                {w.name}
                <small>{w.paperCount} papers</small>
              </span>
            </Menu.Item>
          ))}
          <Menu.Separator />
          <Menu.Item
            onSelect={() => {
              setEdit("create");
              setName("");
            }}
          >
            <Plus size={14} />
            New workspace
          </Menu.Item>
          <Menu.Item
            onSelect={() => {
              setEdit("rename");
              setName(snapshot.workspace.name);
            }}
          >
            <Pencil size={14} />
            Rename workspace
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
  return (
    <>
      <aside
        className={`sidebar ${collapsed ? "collapsed" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="brand">
          <img src="/app-icon.svg" alt="Yara" />
          <div>
            yara<span>RESEARCH WORKSPACE</span>
          </div>
          <button
            className="sidebar-toggle icon-button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onCollapse}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
        {workspaceMenu}
        <div className="sidebar-label">WORKSPACE</div>
        <nav>
          {(
            [
              ["graph", "Research graph", Network],
              ["library", "All papers", BookOpen],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              title={label}
              aria-label={label}
              className={
                view === v && (v === "library" || filters.status === "all")
                  ? "active"
                  : ""
              }
              onClick={() => onNavigate(v, "all")}
            >
              <Icon size={17} />
              <span className="nav-label">{label}</span>
              <span className="nav-count">{papers.length}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-label">COLLECTIONS</div>
        <nav>
          {(
            [
              ["core", Star],
              ["candidate", Bookmark],
              ["read", CheckCircle2],
              ["archived", Archive],
              ["notes", FileText],
            ] as const
          ).map(([status, Icon]) => {
            const label =
              status === "notes"
                ? "With notes"
                : `${labels[status]}${status === "core" ? " papers" : ""}`;
            return (
              <button
                key={status}
                title={label}
                aria-label={label}
                className={
                  filters.status === status && view === "graph" ? "active" : ""
                }
                onClick={() => onNavigate("graph", status)}
              >
                <Icon size={16} className={status} />
                <span className="nav-label">{label}</span>
                <span className="nav-count">
                  {
                    papers.filter((p) =>
                      status === "notes" ? p.hasNote : p.status === status,
                    ).length
                  }
                </span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-label">
          TAGS <span>{allTags.length}</span>
        </div>
        {collapsed ? (
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                className="rail-tags"
                title="Tags"
                aria-label="Filter by tag"
              >
                <Tags size={17} />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="context-menu"
                side="right"
                collisionPadding={8}
              >
                {tags.length ? tags : <Menu.Label>No tags yet</Menu.Label>}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        ) : (
          <div className="sidebar-tags">
            {allTags.length ? (
              allTags.map((t) => (
                <button
                  key={t}
                  className={filters.tag === t ? "active" : ""}
                  onClick={() => onNavigate("graph", "all", t)}
                >
                  <span>#</span>
                  {t}
                </button>
              ))
            ) : (
              <p className="caption">Add tags in a paper’s inspector.</p>
            )}
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span />
            {desktop ? "Local workspace" : "Browser preview"}
            <small>
              {desktop ? "Saved on this device" : "Separate browser storage"}
            </small>
          </div>
          <button
            title="Settings & backups"
            aria-label="Settings & backups"
            onClick={onSettings}
          >
            <Settings2 size={16} />
            <span>Settings & backups</span>
          </button>
          <button
            title={`Switch to ${theme === "dark" ? "light" : "dark"}`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"}`}
            onClick={onTheme}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            <span>Switch to {theme === "dark" ? "light" : "dark"}</span>
          </button>
        </div>
      </aside>
      {edit && (
        <Dialog
          title={edit === "create" ? "New workspace" : "Rename workspace"}
          description="Each workspace keeps its own papers, notes, graph, and source captures."
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (edit === "create") {
                  const w = await backend.call<Workspace>("create_workspace", {
                    name,
                  });
                  await onSwitch(w.id);
                } else {
                  await backend.call("rename_workspace", { name });
                  await onChanged();
                }
                setEdit(null);
                setError("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            <div className="dialog-body">
              <label className="field">
                Workspace name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!name.trim()}>
                Save workspace
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {error && !edit && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
    </>
  );
}
