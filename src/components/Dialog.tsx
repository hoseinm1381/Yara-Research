import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
export function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <D.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content
          className={`dialog ${wide ? "wide" : ""}`}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <header className="dialog-head">
            <div>
              <D.Title>{title}</D.Title>
              <D.Description>
                {description || "Manage your local research workspace."}
              </D.Description>
            </div>
            <D.Close asChild>
              <button className="icon-button" aria-label="Close dialog">
                <X size={19} />
              </button>
            </D.Close>
          </header>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
export function Confirm({
  title,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dialog-body">
        <p>{children}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : "Confirm"}
        </button>
      </footer>
    </Dialog>
  );
}
