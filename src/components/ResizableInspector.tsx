import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
export function ResizableInspector({
  savedWidth,
  onSave,
  children,
}: {
  savedWidth: number;
  onSave: (width: number) => void;
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null),
    frame = useRef(0),
    [width, setWidth] = useState(savedWidth),
    [maximum, setMaximum] = useState(600);
  const active = useRef(false);
  const preferred = useRef(savedWidth);
  const clamp = useCallback((value: number) => {
    const total = shell.current?.parentElement?.clientWidth ?? 1000;
    return Math.round(Math.max(280, Math.min(value, total * 0.6, total - 320)));
  }, []);
  const paint = useCallback(
    (value: number) => {
      const next = clamp(value);
      if (shell.current) {
        shell.current.style.width = `${next}px`;
        const handle = shell.current.querySelector("[role=separator]");
        handle?.setAttribute("aria-valuenow", String(next));
        handle?.setAttribute(
          "aria-valuemax",
          String(clamp(Number.MAX_SAFE_INTEGER)),
        );
      }
      return next;
    },
    [clamp],
  );
  const commit = useCallback(
    (value: number) => {
      const next = paint(value);
      preferred.current = next;
      setWidth(next);
      onSave(next);
    },
    [paint, onSave],
  );
  useEffect(() => {
    const parent = shell.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      if (!active.current) paint(preferred.current);
      setMaximum(clamp(Number.MAX_SAFE_INTEGER));
    });
    observer.observe(parent);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [paint, clamp]);
  return (
    <div className="inspector-shell" ref={shell} style={{ width }}>
      <div
        role="separator"
        aria-label="Resize paper inspector"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={maximum}
        aria-valuenow={width}
        tabIndex={0}
        className="inspector-resize"
        title="Drag to resize · double-click to reset"
        onDoubleClick={() => commit(344)}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
            e.preventDefault();
            commit(
              e.key === "Home"
                ? 344
                : width + (e.key === "ArrowLeft" ? 20 : -20),
            );
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const handle = e.currentTarget;
          handle.setPointerCapture(e.pointerId);
          active.current = true;
          document.body.classList.add("resizing-inspector");
          const start = e.clientX,
            initial = shell.current!.getBoundingClientRect().width;
          let next = initial;
          const move = (event: PointerEvent) => {
            next = initial + start - event.clientX;
            cancelAnimationFrame(frame.current);
            frame.current = requestAnimationFrame(() => paint(next));
          };
          const end = () => {
            cancelAnimationFrame(frame.current);
            active.current = false;
            document.body.classList.remove("resizing-inspector");
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
            commit(next);
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", end);
          handle.addEventListener("pointercancel", end);
        }}
      />
      {children}
    </div>
  );
}
