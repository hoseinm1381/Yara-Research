import { afterEach, it, expect, vi } from "vitest";
import { extractPage } from "../../extension/capture";
afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});
function page(
  html: string,
  url = "https://ieeexplore.ieee.org/document/726791",
) {
  vi.stubGlobal("location", new URL(url));
  document.documentElement.innerHTML = html;
}
it("extracts generic bibliographic metadata without calling it IEEE", () => {
  page(
    '<head><meta name="citation_title" content="Generic paper"><meta name="citation_doi" content="10.1234/generic"><meta name="citation_author" content="Jane Doe"></head><body></body>',
    "https://publisher.example/paper",
  );
  const result = extractPage();
  expect(result.provider).toBe("Web");
  expect(result.focal.doi).toBe("10.1234/generic");
  expect(() => extractPage("references")).toThrow("only on an IEEE");
});
it("metadata-only capture does not collect relationship sections", () => {
  page(
    '<head><meta name="citation_title" content="Focal"></head><body><section id="references"><li data-doi="10.1234/b" data-title="B">B</li></section></body>',
  );
  const result = extractPage("paper");
  expect(result.items).toEqual([]);
  expect(result.focal.ieee).toBe("726791");
});
it("does not label alternate IEEE ports or insecure origins as IEEE source evidence", () => {
  for (const url of [
    "http://ieeexplore.ieee.org/document/726791",
    "https://ieeexplore.ieee.org:8443/document/726791",
  ]) {
    page(
      '<head><meta name="citation_title" content="Article"></head><body></body>',
      url,
    );
    expect(extractPage().provider).toBe("Web");
    expect(extractPage().focal.ieee).toBe("");
  }
});
it("captures dynamically loaded IEEE references and retains partial coverage", () => {
  page(
    '<head><meta name="citation_title" content="Focal"></head><body><section id="references" data-total-count="43"><li data-title="Reference B" data-doi="10.1234/b">B 2021</li></section></body>',
  );
  const result = extractPage("references");
  expect(result.items).toHaveLength(1);
  expect(result.items[0].doi).toBe("10.1234/b");
  expect(result.coverage).toBe("partial");
  expect(result.total).toBe(43);
  expect(result.direction).toBe("references");
});
it("does not assume completeness when every currently displayed entry was captured", () => {
  page(
    '<head><meta name="citation_title" content="Focal"></head><body><section id="references"><li data-title="B">Reference B</li></section></body>',
  );
  expect(extractPage("references").coverage).toBe("unknown");
});
it("complete fixture requires explicit single-page and matching total semantics", () => {
  page(
    '<head><meta name="citation_title" content="Focal"></head><body><section id="references" data-total-count="1" data-pages="1"><li data-title="B" data-doi="10.1234/b">B</li></section></body>',
  );
  expect(extractPage("references").coverage).toBe("complete");
});
it("keeps citation directions independent and ignores untrusted executable scripts", () => {
  page(
    '<head><meta name="citation_title" content="Focal"></head><body><script>window.injected=true</script><section id="references"><li data-title="B" data-doi="10.1234/b">B</li></section><section id="citations"><li data-title="C" data-doi="10.1234/c">C</li></section></body>',
  );
  expect(extractPage("citing").items[0].doi).toBe("10.1234/c");
  expect(extractPage("references").items[0].doi).toBe("10.1234/b");
  expect("injected" in window).toBe(false);
});
it("uses scholarly JSON-LD references without executing their containing script", () => {
  page(
    '<head><script type="application/ld+json">{"@type":"ScholarlyArticle","name":"Focal","citation":[{"@type":"ScholarlyArticle","name":"B","identifier":"10.1234/b"}]}</script></head><body></body>',
  );
  const result = extractPage("references");
  expect(result.items[0].title).toBe("B");
  expect(result.method).toContain("JSON-LD");
  expect(result.coverage).toBe("unknown");
});
it("reports sections not loaded instead of fabricating an empty complete list", () => {
  page(
    '<head><meta name="citation_title" content="Focal"></head><body></body>',
  );
  const result = extractPage("references");
  expect(result.coverage).toBe("unknown");
  expect(result.items).toEqual([]);
  expect(result.warning).toContain("could not be recognized");
});
