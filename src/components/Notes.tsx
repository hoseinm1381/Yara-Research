import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Save, RefreshCw, ExternalLink, Code2 } from "lucide-react";
import { backend, desktop } from "../services/backend";
import { confirmAction } from "../services/confirmation";
import type { Note, Paper } from "../types";
export function Notes({
  paper,
  notify,
  onDirty,
}: {
  paper: Paper;
  notify: (s: string) => void;
  onDirty: (v: boolean) => void;
}) {
  const [note, setNote] = useState<Note | null>(null),
    [text, setText] = useState(""),
    [preview, setPreview] = useState(false),
    [external, setExternal] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef({ dirty: false, revision: "" });
  const load = useCallback(async () => {
    try {
      const n = await backend.readNote(paper.id);
      setNote(n);
      setText(n.content);
      setExternal(false);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [paper.id]);
  useEffect(() => {
    let active = true;
    void backend
      .readNote(paper.id)
      .then((n) => {
        if (active) {
          setNote(n);
          setText(n.content);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [paper.id]);
  const dirty = note !== null && text !== note.content;
  useEffect(() => {
    current.current = { dirty, revision: note?.revision ?? "" };
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, note?.revision, onDirty]);
  useEffect(() => {
    const check = async () => {
      try {
        const n = await backend.readNote(paper.id);
        if (n.revision !== current.current.revision) {
          if (current.current.dirty) setExternal(true);
          else {
            setNote(n);
            setText(n.content);
            setExternal(false);
          }
        }
      } catch (e) {
        setError(String(e));
      }
    };
    const timer = setInterval(() => void check(), 3000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [paper.id]);
  const save = useCallback(async () => {
    if (!note) return;
    setBusy(true);
    try {
      const n = await backend.saveNote(paper.id, text, note.revision);
      setNote(n);
      setExternal(false);
      setError("");
      notify("Markdown note saved");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [note, paper.id, text, notify]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);
  const open = async (editor: string) => {
    try {
      notify(await backend.call<string>("open_note", { id: paper.id, editor }));
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="notes-panel">
      <div className="segmented">
        <button
          className={!preview ? "active" : ""}
          onClick={() => setPreview(false)}
        >
          Write
        </button>
        <button
          className={preview ? "active" : ""}
          onClick={() => setPreview(true)}
        >
          Preview
        </button>
        <span className="muted">
          {dirty
            ? "Unsaved changes"
            : note?.exists
              ? "Saved locally"
              : "Missing file"}
        </span>
      </div>
      {external && (
        <p className="error">
          This file changed outside Yara. Copy your unsaved text before
          reloading.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview ? (
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children }) => (
                <button
                  className="text-link"
                  onClick={() =>
                    href &&
                    void backend
                      .call("open_url", { url: href })
                      .catch((e) => setError(String(e)))
                  }
                >
                  {children}
                </button>
              ),
              img: () => null,
            }}
          >
            {text}
          </Markdown>
        </div>
      ) : (
        <textarea
          aria-label="Markdown note"
          className="note-editor"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      )}
      <div className="note-actions">
        <button
          className="primary"
          disabled={busy || !note || external}
          onClick={() => void save()}
        >
          <Save size={14} />
          Save note
        </button>
        <button
          title="Reload from disk"
          onClick={async () => {
            if (
              !dirty ||
              (await confirmAction(
                "Discard unsaved edits and reload the file?",
              ))
            )
              void load();
          }}
        >
          <RefreshCw size={14} />
        </button>
        {desktop && (
          <>
            <button onClick={() => void open("vscode")}>
              <Code2 size={14} />
              VS Code
            </button>
            <button
              title="Open in default editor"
              onClick={() => void open("default")}
            >
              <ExternalLink size={14} />
            </button>
          </>
        )}
      </div>
      <p className="caption">
        {desktop
          ? "UTF-8 Markdown · external edits checked every 3 seconds"
          : "Browser preview note · install the desktop app for Markdown files and VS Code"}
      </p>
    </div>
  );
}
