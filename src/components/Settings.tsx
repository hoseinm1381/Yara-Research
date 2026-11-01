import { useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Download, Upload, FolderArchive, ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import { backend, desktop } from "../services/backend";
import type { Snapshot } from "../types";
import { confirmAction } from "../services/confirmation";
export function Settings({
  snapshot,
  onClose,
  notify,
  reload,
  onDemo,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  notify: (s: string) => void;
  reload: () => Promise<void>;
  onDemo: () => Promise<void>;
}) {
  const [key, setKey] = useState(""),
    [vscode, setVscode] = useState(snapshot.settings.vscode || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function backup(restore = false) {
    setBusy(true);
    setError("");
    try {
      if (restore) {
        const path = await open({
          multiple: false,
          filters: [{ name: "Yara workspace", extensions: ["yara"] }],
        });
        if (!path) return;
        if (
          !(await confirmAction(
            "Activate a restored workspace? Your current workspace will be preserved in its original folder. Unsaved edits should be saved first.",
          ))
        )
          return;
        await backend.call("restore_backup", { path });
        await reload();
        notify("Backup validated and restored. Previous workspace preserved.");
        onClose();
      } else {
        const path = await save({
          defaultPath: `Yara-backup-${new Date().toISOString().slice(0, 10)}.yara`,
          filters: [{ name: "Yara workspace", extensions: ["yara"] }],
        });
        if (!path) return;
        await backend.call("export_backup", { path });
        notify(`Complete workspace backup saved to ${path}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Workspace settings"
      description="Local by default. Connected when you choose."
      onClose={onClose}
    >
      <div className="dialog-body settings-body">
        <section>
          <h3>
            <ShieldCheck size={17} />
            Your data stays here
          </h3>
          <p className="caption">{snapshot.root}</p>
          <p>
            Research is stored locally. Online discovery sends your search or
            selected work ID to OpenAlex only when requested.
          </p>
        </section>
        <section>
          <h3>OpenAlex</h3>
          <p>
            Basic queries can work without a key. A free API key increases the
            provider’s limits. Yara stores your key in memory for this session
            only; it is excluded from backups.
          </p>
          <label className="field">
            Session API key
            <input
              aria-label="OpenAlex API key"
              autoComplete="off"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Optional — never saved to disk"
            />
          </label>
          <button
            onClick={() =>
              void backend
                .call("set_api_key", { key })
                .then(() => {
                  setKey("");
                  notify(
                    key
                      ? "API key set for this session"
                      : "Session API key cleared",
                  );
                })
                .catch((e) => setError(String(e)))
            }
          >
            Apply session key
          </button>
          <button
            className="text-link"
            onClick={() =>
              void backend
                .call("open_url", { url: "https://openalex.org/settings/api" })
                .catch((e) => setError(String(e)))
            }
          >
            Get a free OpenAlex key ↗
          </button>
        </section>
        <section>
          <h3>Markdown & VS Code</h3>
          <label className="field">
            VS Code executable path
            <input
              value={vscode}
              placeholder="C:\…\Microsoft VS Code\Code.exe"
              onChange={(e) => setVscode(e.target.value)}
            />
          </label>
          <button
            onClick={() =>
              void backend
                .call("set_setting", { key: "vscode", value: vscode })
                .then(() => notify("Editor path saved"))
                .catch((e) => setError(String(e)))
            }
          >
            Save editor path
          </button>
          <p className="caption">
            Yara detects common installations automatically. If unavailable, use
            your default Markdown editor from the Notes tab.
          </p>
        </section>
        <section>
          <h3>
            <FolderArchive size={17} />
            Backup & restore
          </h3>
          <p>
            A versioned .yara archive includes a consistent SQLite snapshot and
            all paper Markdown notes, with checksums. Restore validates a
            separate workspace before switching to it.
          </p>
          <div className="row">
            <button disabled={busy || !desktop} onClick={() => void backup()}>
              <Download size={15} />
              Export backup
            </button>
            <button
              disabled={busy || !desktop}
              onClick={() => void backup(true)}
            >
              <Upload size={15} />
              Restore backup
            </button>
          </div>
          {!desktop && (
            <p className="notice">
              File backup, restore, and editor integration require the desktop
              app. This browser preview has separate local browser storage.
            </p>
          )}
        </section>
        <section>
          <h3>Optional demonstration workspace</h3>
          <p>
            Load a small, clearly marked graph to explore the interface. Demo
            records are only offered in an empty workspace.
          </p>
          <button
            disabled={snapshot.papers.length > 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDemo();
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Load demonstration
          </button>
          {snapshot.papers.length > 0 &&
            snapshot.papers.every((p) =>
              p.source.startsWith("Optional demo"),
            ) && (
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      "Reset the demo dataset? Demo paper records and connections will be removed; Markdown files remain available for recovery.",
                    ))
                  )
                    return;
                  setBusy(true);
                  try {
                    await backend.call("reset_demo");
                    await reload();
                    notify("Demo dataset reset. Markdown files retained.");
                    onClose();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reset demo dataset
              </button>
            )}
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <button onClick={onClose}>Done</button>
      </footer>
    </Dialog>
  );
}
