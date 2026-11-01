import { extractPage } from "./capture";
import type { PageCapture, CapturedPaper } from "./capture";
import { newPaper } from "../src/types";
import type { Paper } from "../src/types";
export type Direction = "paper" | "references" | "citing";
export interface ExtensionAPI {
  tabs: {
    query: (options: {
      active: boolean;
      currentWindow: boolean;
    }) => Promise<{ id?: number; url?: string }[]>;
  };
  scripting: {
    executeScript: <T>(options: {
      target: { tabId: number };
      func: (mode: Direction) => T;
      args: [Direction];
    }) => Promise<{ result?: T }[]>;
  };
  runtime: {
    sendNativeMessage: (host: string, message: unknown) => Promise<unknown>;
  };
}
function within<T>(
  operation: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), Math.max(1, ms));
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function context(url: string) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol))
    throw new Error("Open a normal publisher article tab.");
  if (
    u.hostname === "ieeexplore.ieee.org" &&
    u.protocol === "https:" &&
    !u.port
  ) {
    const id = u.pathname.match(
      /^\/(?:abstract\/)?document\/(\d+)(?:\/(?:abstract|authors|figures|references|citations|keywords|metrics|footnotes))?\/?$/,
    )?.[1];
    if (!id)
      throw new Error(
        "Open the IEEE article detail page rather than search or the PDF viewer.",
      );
    return `https://ieeexplore.ieee.org/document/${id}`;
  }
  u.hash = "";
  return u.href;
}
export async function readActivePage(
  api: ExtensionAPI,
  direction: Direction,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id)
    throw new Error("Select an article tab and reopen Send to Yara.");
  const expected = tab.url ? context(tab.url) : null,
    started = performance.now();
  const timeout = Math.max(0, Math.min(options.timeoutMs ?? 3200, 5000)),
    interval = Math.max(20, options.intervalMs ?? 250);
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      const response = await within(
        api.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPage,
          args: [direction],
        }),
        Math.max(250, timeout - (performance.now() - started)),
        "Metadata extraction timed out. Check that the article has finished loading, then retry.",
      );
      const data = response[0]?.result;
      if (
        !data ||
        !data.focal ||
        typeof data.focal.title !== "string" ||
        !Array.isArray(data.focal.authors) ||
        !Array.isArray(data.items) ||
        !["IEEE", "Web"].includes(data.provider) ||
        data.direction !== direction
      )
        throw new Error(
          "The page returned an invalid metadata response. Reopen the article and retry.",
        );
      if (expected && context(data.pageUrl) !== expected)
        throw new Error(
          "The active article changed during extraction. Reopen Send to Yara for the new article.",
        );
      if (
        data.provider !== "IEEE" ||
        data.diagnostics?.ready ||
        performance.now() - started >= timeout
      ) {
        if (data.diagnostics)
          data.diagnostics = {
            ...data.diagnostics,
            attempts,
            elapsedMs: Math.round(performance.now() - started),
          };
        return data;
      }
    } catch (e) {
      if (
        !String(e).includes("metadata is still loading") ||
        performance.now() - started >= timeout
      )
        throw e;
    }
    await new Promise((r) =>
      setTimeout(
        r,
        Math.min(
          interval,
          Math.max(0, timeout - (performance.now() - started)),
        ),
      ),
    );
  }
}
export async function assertActivePage(api: ExtensionAPI, pageUrl: string) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id)
    throw new Error(
      "The article tab is unavailable. Read metadata again before importing.",
    );
  const result = await within(
    api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => location.href,
      args: ["paper"],
    }),
    3200,
    "The article check timed out. Read metadata again before importing.",
  );
  if (!result[0]?.result || context(result[0].result) !== context(pageUrl))
    throw new Error(
      "The active article changed. Read metadata again before importing; the previous preview was not sent.",
    );
}
// Explicit mapping is shared by the popup and boundary regression tests.
export function paperFromCapture(p: CapturedPaper, source: string): Paper {
  return newPaper({
    title: p.title,
    authors: p.authors.slice(),
    year: p.year,
    doi: p.doi,
    openalex: p.openalex,
    ieee: p.ieee,
    url: p.url,
    abstract: p.abstract,
    journal: p.journal,
    publisher: p.publisher,
    publicationDate: p.publicationDate,
    keywords: p.keywords.slice(),
    citationCount: p.citationCount,
    raw: p.raw,
    source,
  });
}
export function paperPayload(
  workspaceId: string,
  paper: Paper,
  capture: PageCapture,
): Record<string, unknown> {
  return {
    version: 1,
    action: "import_paper",
    workspaceId,
    paper,
    pageUrl: capture.pageUrl,
    provider: capture.provider,
  };
}
export async function sendToYara(
  api: ExtensionAPI,
  payload: unknown,
  timeoutMs = 15000,
): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
  workspaces?: import("../src/types").Workspace[];
}> {
  const response = await within(
    api.runtime.sendNativeMessage("org.yara.research", payload),
    timeoutMs,
    "Yara did not respond in time. Retry the same preview; repeated delivery is safe.",
  );
  if (
    !response ||
    typeof response !== "object" ||
    !("ok" in response) ||
    typeof response.ok !== "boolean"
  )
    throw new Error(
      "Yara returned an invalid response. Retry the connection; no success was confirmed.",
    );
  if (
    ("message" in response && typeof response.message !== "string") ||
    ("error" in response && typeof response.error !== "string")
  )
    throw new Error(
      "Yara returned an invalid response. No success was confirmed.",
    );
  const action =
    payload && typeof payload === "object" && "action" in payload
      ? payload.action
      : null;
  if (
    response.ok &&
    action === "list_workspaces" &&
    (!("workspaces" in response) ||
      !Array.isArray(response.workspaces) ||
      response.workspaces.some(
        (w) => !w || typeof w.id !== "string" || typeof w.name !== "string",
      ))
  )
    throw new Error(
      "Yara returned an invalid workspace list. Retry connection.",
    );
  if (
    response.ok &&
    action === "import_paper" &&
    (!("paperId" in response) || typeof response.paperId !== "string")
  )
    throw new Error(
      "Yara returned an invalid import response. No success was confirmed.",
    );
  return response as {
    ok: boolean;
    message?: string;
    error?: string;
    workspaces?: import("../src/types").Workspace[];
  };
}
