import { useSyncExternalStore } from "react";
import { Dialog } from "../components/Dialog";
interface Request {
  message: string;
  resolve: (value: boolean) => void;
}
let queue: Request[] = [];
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());
export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { message, resolve }];
    publish();
  });
}
function respond(value: boolean) {
  const request = queue[0];
  queue = queue.slice(1);
  publish();
  request?.resolve(value);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function ConfirmationHost() {
  const request = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  if (!request) return null;
  return (
    <Dialog
      title="Confirm your action"
      description="Review this change before continuing."
      onClose={() => respond(false)}
    >
      <div className="dialog-body">
        <p>{request.message}</p>
      </div>
      <footer className="dialog-footer">
        <button onClick={() => respond(false)}>Cancel action</button>
        <button className="primary" onClick={() => respond(true)}>
          Confirm action
        </button>
      </footer>
    </Dialog>
  );
}
