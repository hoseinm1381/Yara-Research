import { chromium } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const results = [];
try {
  for (const count of [100, 300, 500]) {
    await page.goto("http://127.0.0.1:1420");
    await page.evaluate((n) => {
      const now = new Date().toISOString();
      const papers = Array.from({ length: n }, (_, i) => ({
        id: crypto.randomUUID(),
        title: `Scientific research paper ${i + 1}`,
        authors: ["Researcher"],
        year: 2024,
        doi: "",
        openalex: "",
        abstract: "",
        journal: "Performance fixture",
        publisher: "",
        url: "",
        publicationDate: "",
        citationCount: null,
        status: i % 12 === 0 ? "core" : "unreviewed",
        tags: [],
        keywords: [],
        summary: "",
        strengths: "",
        weaknesses: "",
        findings: "",
        relevance: "",
        tasks: "",
        raw: "",
        source: "Performance fixture",
        references: [],
        x: (i % 25) * 340,
        y: Math.floor(i / 25) * 190,
        pinned: false,
        hidden: false,
        hasNote: false,
        createdAt: now,
        updatedAt: now,
        lastDiscovery: "",
      }));
      const citations = papers.slice(1).map((p, i) => ({
        citing: p.id,
        cited: papers[i].id,
        source: "fixture",
        verified: true,
        createdAt: now,
      }));
      localStorage.setItem(
        "yara-browser-preview-v1",
        JSON.stringify({
          papers,
          citations,
          settings: {},
          root: "Performance fixture",
        }),
      );
    }, count);
    const start = Date.now();
    await page.reload();
    await page.locator(".react-flow__viewport").waitFor();
    await page.getByTestId("paper-node").first().waitFor({state:'attached'});
    await page.getByTitle("Fit graph to view", { exact: true }).click();
    await page.waitForTimeout(500);
    const loadMs = Date.now() - start;
    const visible=page.locator('.react-flow__node:visible');await visible.first().waitFor();
    const renderedBeforeZoom = await visible.count();
    const box = await visible.first().boundingBox();
    const panStart = Date.now();
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -150);
    }
    await page.screenshot({ path: `.tooling/graph-${count}.png` });
    const interactionMs = Date.now() - panStart;
    results.push({
      storedPapers: count,
      storedEdges: count - 1,
      renderedBeforeZoom,
      visibleRenderedNodes: await page.getByTestId("paper-node").count(),
      loadMs,
      fiveZoomEventsAndScreenshotMs: interactionMs,
    });
  }
} finally {
  await browser.close();
  fs.mkdirSync("docs/evidence", { recursive: true });
  fs.writeFileSync(
    "docs/evidence/graph-performance.json",
    JSON.stringify(
      {
        kind: "Headless Edge graph timing; engineering measurement, not a frame-rate guarantee",
        results,
      },
      null,
      2,
    ),
  );
}
