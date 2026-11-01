import { it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach } from "vitest";
import { Notes } from "../components/Notes";
import { newPaper } from "../types";
import { backend } from "../services/backend";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("saves real browser-adapter notes and reloads them with Unicode intact", async () => {
  const paper = newPaper({ title: "Research" });
  await backend.save(paper);
  render(<Notes paper={paper} notify={() => {}} onDirty={() => {}} />);
  const editor = await screen.findByLabelText("Markdown note");
  await waitFor(() =>
    expect((editor as HTMLTextAreaElement).value).toContain("# Research"),
  );
  fireEvent.change(editor, { target: { value: "# پژوهش\n\nScience 科学" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(async () =>
    expect((await backend.readNote(paper.id)).content).toBe(
      "# پژوهش\n\nScience 科学",
    ),
  );
});
it("rejects stale note revisions instead of overwriting external changes", async () => {
  const p = await backend.save(newPaper({ title: "Notes" }));
  const original = await backend.readNote(p.id);
  await backend.saveNote(p.id, "External edit", original.revision);
  await expect(
    backend.saveNote(p.id, "Stale edit", original.revision),
  ).rejects.toThrow("changed externally");
  expect((await backend.readNote(p.id)).content).toBe("External edit");
});
it("does not render script elements or raw HTML in Markdown preview", async () => {
  const p = await backend.save(newPaper({ title: "Untrusted" }));
  const n = await backend.readNote(p.id);
  await backend.saveNote(
    p.id,
    "<script>alert(1)</script>\n\n**Safe text**\n\n[bad](javascript:alert(1))",
    n.revision,
  );
  render(<Notes paper={p} notify={() => {}} onDirty={() => {}} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Markdown note") as HTMLTextAreaElement).value,
    ).toContain("Safe text"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(screen.getByText("Safe text").tagName).toBe("STRONG");
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
});
