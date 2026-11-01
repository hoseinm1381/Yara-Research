import { afterEach, expect, it, vi } from "vitest";
import observed from "../../tests/fixtures/ieee-metadata-observed.html?raw";
import { extractPage } from "../../extension/capture";
import {
  readActivePage,
  assertActivePage,
  paperFromCapture,
  paperPayload,
  sendToYara,
} from "../../extension/client";
import type { ExtensionAPI } from "../../extension/client";
const url = "https://ieeexplore.ieee.org/document/726791";
function page(html = observed, href = url) {
  vi.stubGlobal("location", new URL(href));
  document.documentElement.innerHTML = html;
}
function api(): ExtensionAPI {
  return {
    tabs: { query: vi.fn(async () => [{ id: 7, url }]) },
    scripting: {
      executeScript: vi.fn(async ({ func, args }) => [
        { result: func(args[0]) },
      ]),
    },
    runtime: {
      sendNativeMessage: vi.fn(async () => ({
        ok: true,
        paperId: crypto.randomUUID(),
        message: "Saved",
      })),
    },
  };
}
afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  vi.unstubAllGlobals();
});
it("extracts all supported fields from the observed IEEE inline JSON, not just og:title", () => {
  page();
  const { focal: p, diagnostics } = extractPage();
  expect(p.title).toBe(
    "Gradient-based learning applied to document recognition",
  );
  expect(p.authors).toEqual([
    "Y. Lecun",
    "L. Bottou",
    "Y. Bengio",
    "P. Haffner",
  ]);
  expect(p.doi).toBe("10.1109/5.726791");
  expect(p.year).toBe(1998);
  expect(p.publicationDate).toBe("November 1998");
  expect(p.journal).toBe("Proceedings of the IEEE");
  expect(p.publisher).toBe("IEEE");
  expect(p.abstract).toBe(
    "Multilayer neural networks trained with the back-propagation algorithm constitute the best example of a successful gradient based learning technique.",
  );
  expect(p.keywords).toEqual([
    "Neural networks",
    "Pattern recognition",
    "Gradient-based Learning",
    "Convolutional Network",
  ]);
  expect(p.citationCount).toBe(49111);
  expect(p.raw).toContain('"referenceCount":121');
  expect(p.raw).not.toContain("userInfo");
  expect(p.raw).not.toContain("MUST_NOT_LEAK");
  expect(diagnostics?.fieldSources.doi).toBe("IEEE JSON");
  expect(diagnostics?.missing).toEqual([]);
  expect(diagnostics?.ready).toBe(true);
});
it("retains ordered Unicode authors and scientific notation, deduplicating authors without affiliations", () => {
  page(
    `<meta name="citation_title" content="Résumé &amp; 研究: A &lt;T&gt; model"><meta name="citation_author" content="Zoë García"><meta name="citation_author" content="李华"><meta name="citation_author" content="Zoë García"><meta name="citation_abstract" content="Abstract: α² + β ≤ 1.&#10;&#10;A second paragraph."><meta name="citation_keywords" content="α; 認識; α">`,
  );
  const p = extractPage().focal;
  expect(p.title).toBe("Résumé & 研究: A <T> model");
  expect(p.authors).toEqual(["Zoë García", "李华"]);
  expect(p.abstract).toContain("α² + β ≤ 1.");
  expect(p.abstract).toContain("\n\nA second paragraph.");
  expect(p.keywords).toEqual(["α", "認識"]);
});
it("uses observed IEEE DOM as fallback without importing affiliations or navigation", () => {
  page(
    `<h1 class="document-title">DOM paper</h1><span class="authors-info"><a href="/author/1">Jane Doe</a><a href="https://orcid.org/1">ORCID</a><span>University affiliation</span></span><div class="abstract-text">Abstract:<p>First paragraph α.</p><p>Second paragraph.</p></div><a class="stats-document-abstract-publishedIn">Observed venue</a><div class="doc-abstract-pubdate">Date of Publication: 13 December 2022</div><div class="doc-abstract-publisher">Publisher: IEEE</div><div class="doc-abstract-doi"><a href="https://doi.org/10.1234/dom">DOI</a></div><nav>Unrelated navigation</nav>`,
  );
  const p = extractPage().focal;
  expect(p.authors).toEqual(["Jane Doe"]);
  expect(p.doi).toBe("10.1234/dom");
  expect(p.journal).toBe("Observed venue");
  expect(p.publicationDate).toBe("13 December 2022");
  expect(p.abstract).toBe("First paragraph α.\n\nSecond paragraph.");
  expect(p.abstract).not.toContain("navigation");
});
it("does not overwrite JSON-LD venue, publisher, full abstract or complete authors with empty/partial tags", () => {
  page(
    `<meta name="citation_title" content="Article"><meta name="citation_author" content="First"><meta name="description" content="Short preview"><script type="application/ld+json">{"@graph":[{"@type":"ScholarlyArticle","name":"Article","author":[{"givenName":"First","familyName":"Author"},{"name":"Second Author"}],"datePublished":"2024-04-15","isPartOf":{"name":"Structured venue"},"publisher":{"name":"Structured publisher"},"abstract":"A complete abstract with α and all its scientific detail.","keywords":["Research","research","Σ"]}]}</script>`,
  );
  const p = extractPage().focal;
  expect(p.authors).toEqual(["First Author", "Second Author"]);
  expect(p.journal).toBe("Structured venue");
  expect(p.publisher).toBe("Structured publisher");
  expect(p.publicationDate).toBe("2024-04-15");
  expect(p.keywords).toEqual(["Research", "Σ"]);
  expect(p.abstract).toContain("all its scientific detail");
});
it("leaves absent metadata empty and preserves an intentional title-only import", async () => {
  page('<meta name="og:title" content="Title only">');
  const a = api();
  const result = await readActivePage(a, "paper", {
    timeoutMs: 40,
    intervalMs: 20,
  });
  expect(result.focal.authors).toEqual([]);
  expect(result.focal.doi).toBe("");
  expect(result.focal.publicationDate).toBe("");
  expect(result.focal.keywords).toEqual([]);
  expect(result.focal.year).toBeNull();
  expect(result.warning).toContain("Only the paper title");
  expect(
    paperPayload("destination", paperFromCapture(result.focal, "IEEE"), result)
      .paper,
  ).toMatchObject({ title: "Title only", ieee: "726791" });
});
it("retries briefly for delayed metadata and stops immediately when it is ready", async () => {
  page('<meta name="og:title" content="Loading article">');
  const a = api();
  let attempts = 0;
  a.scripting.executeScript = vi.fn(async ({ func, args }) => {
    if (++attempts === 3) page();
    return [{ result: func(args[0]) }];
  });
  const result = await readActivePage(a, "paper", {
    timeoutMs: 250,
    intervalMs: 20,
  });
  expect(attempts).toBe(3);
  expect(result.focal.doi).toBe("10.1109/5.726791");
  expect(result.diagnostics?.attempts).toBe(3);
  await readActivePage(a, "paper");
  expect(attempts).toBe(4);
});
it("ignores malformed JSON/dates and never evaluates embedded JavaScript", () => {
  page(
    `<meta name="citation_title" content="Still works"><meta name="citation_publication_date" content="2024-99-99"><script type="application/ld+json">{invalid}</script><script>xplGlobal.document.metadata={"articleNumber":"726791", evil: window.executeMe=true};window.executeMe=true;</script>`,
  );
  const p = extractPage().focal;
  expect(p.title).toBe("Still works");
  expect(p.year).toBeNull();
  expect(p.publicationDate).toBe("");
  expect("executeMe" in window).toBe(false);
});
it("rejects stale SPA metadata and article navigation during extraction or before sending", async () => {
  page(observed.replace('"articleNumber":"726791"', '"articleNumber":"999"'));
  expect(() => extractPage()).toThrow("metadata is still loading");
  const a = api();
  await expect(
    readActivePage(a, "paper", { timeoutMs: 30, intervalMs: 20 }),
  ).rejects.toThrow("metadata is still loading");
  page(observed, "https://ieeexplore.ieee.org/document/999");
  await expect(assertActivePage(a, url)).rejects.toThrow("article changed");
  await expect(readActivePage(a, "paper")).rejects.toThrow("article changed");
});
it("recognizes only supported article views and canonicalizes tracking/section URLs", () => {
  for (const suffix of [
    "/keywords?tracking=1#section",
    "/authors",
    "/references",
    "/",
  ]) {
    page(observed, url + suffix);
    expect(extractPage().pageUrl).toBe(url);
  }
  page(observed, "https://ieeexplore.ieee.org/abstract/document/726791");
  expect(extractPage().focal.ieee).toBe("726791");
  for (const path of [
    "/search/searchresult.jsp",
    "/stamp/stamp.jsp?arnumber=726791",
    "/login",
  ]) {
    page("<title>Sign in</title>", "https://ieeexplore.ieee.org" + path);
    expect(() => extractPage()).toThrow("detail page");
  }
  page(
    "<title>JavaScript is disabled</title><body>Verify you are not a robot</body>",
  );
  expect(() => extractPage()).toThrow("verification");
});
it("explicitly maps every extracted field through the unchanged native import payload", async () => {
  page();
  const a = api(),
    capture = await readActivePage(a, "paper"),
    p = paperFromCapture(capture.focal, capture.provider);
  const payload = {
    ...paperPayload("workspace-id", p, capture),
    requestId: crypto.randomUUID(),
  };
  await sendToYara(a, payload);
  expect(a.runtime.sendNativeMessage).toHaveBeenCalledWith(
    "org.yara.research",
    expect.objectContaining({
      version: 1,
      action: "import_paper",
      paper: expect.objectContaining({
        authors: capture.focal.authors,
        doi: capture.focal.doi,
        abstract: capture.focal.abstract,
        journal: capture.focal.journal,
        publisher: "IEEE",
        publicationDate: "November 1998",
        keywords: capture.focal.keywords,
        year: 1998,
        citationCount: 49111,
      }),
    }),
  );
  expect(JSON.stringify(payload)).not.toContain("MUST_NOT_LEAK");
});
it("reports unavailable hosts, invalid native responses and scripting failures without confirming success", async () => {
  const a = api();
  a.runtime.sendNativeMessage = vi.fn(async () => {
    throw new Error("Specified native messaging host not found.");
  });
  await expect(sendToYara(a, {})).rejects.toThrow("host not found");
  a.runtime.sendNativeMessage = vi.fn(async () => ({
    message: "looks successful",
  }));
  await expect(sendToYara(a, {})).rejects.toThrow("invalid response");
  a.scripting.executeScript = vi.fn(async () => {
    throw new Error("Cannot access contents of the page");
  });
  await expect(readActivePage(a, "paper")).rejects.toThrow("Cannot access");
});
it("bounds a stalled extraction or native-host operation without confirming success", async () => {
  const a = api();
  a.scripting.executeScript = vi.fn(() => new Promise<never>(() => {}));
  await expect(readActivePage(a, "paper", { timeoutMs: 30 })).rejects.toThrow(
    "timed out",
  );
  a.runtime.sendNativeMessage = vi.fn(() => new Promise(() => {}));
  await expect(sendToYara(a, {}, 20)).rejects.toThrow(
    "did not respond in time",
  );
});
it("balances braces and escaped quotes as JSON data without executing the surrounding script", () => {
  const data = {
    articleNumber: "726791",
    title: 'Balanced {braces} and "quotes"',
    abstract: 'A string contains }; and "quoted" text.',
    authors: [{ name: "Researcher" }],
    doi: "10.1234/(balanced)",
  };
  page(
    "<script>xplGlobal.document.metadata=" +
      JSON.stringify(data) +
      ";window.shouldNotExecute=true;</script>",
  );
  const p = extractPage().focal;
  expect(p.title).toBe(data.title);
  expect(p.abstract).toBe(data.abstract);
  expect(p.doi).toBe("10.1234/(balanced)");
  expect("shouldNotExecute" in window).toBe(false);
});
