/* global chrome, document */
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// This uses real extension APIs/host/SQLite. Fixture and unmodified live-page
// checks are recorded separately. Account data and source scripts are never saved.
export async function verifyMetadata({ app, call, data, proof, check }) {
  const root = process.cwd(),
    id = fs.readFileSync("extension/extension-id.txt", "utf8").trim();
  const context = await chromium.launchPersistentContext(
    path.join(data, "profile-metadata-chrome"),
    {
      channel: "chrome",
      headless: true,
      env: { ...process.env, YARA_DATA_DIR: data },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging"],
    },
  );
  const live = [];
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const setup = context.pages()[0];
    await setup.goto("chrome://extensions");
    await setup.evaluate(() =>
      chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      }),
    );
    await cdp.send("Extensions.loadUnpacked", {
      path: path.join(root, ".tooling", "extension-build"),
    });
    await expect
      .poll(async () =>
        (await cdp.send("Extensions.getExtensions")).extensions.some(
          (e) => e.id === id && e.enabled,
        ),
      )
      .toBe(true);
    async function popupFor(article, title) {
      for (const page of context
        .pages()
        .filter((p) => p.url().startsWith("chrome-extension://")))
        await page.close();
      await article.bringToFront();
      const targets = (await cdp.send("Target.getTargets", { filter: [{}] }))
        .targetInfos;
      const target = targets.find(
        (t) => t.type === "tab" && t.url === article.url(),
      );
      if (!target)
        throw new Error(
          "Article tab was not available to the real extension action.",
        );
      await cdp.send("Extensions.triggerAction", {
        id,
        targetId: target.targetId,
      });
      await cdp.send("Target.createTarget", {
        url: `chrome-extension://${id}/popup.html`,
        background: true,
      });
      await expect
        .poll(() =>
          context
            .pages()
            .some((p) => p.url().startsWith(`chrome-extension://${id}/`)),
        )
        .toBe(true);
      const popup = context
        .pages()
        .find((p) => p.url().startsWith(`chrome-extension://${id}/`));
      await expect(popup.getByLabel("Focal paper title")).toHaveValue(title, {
        timeout: 10000,
      });
      return popup;
    }
    function stored(snapshot, paperId) {
      const db = new DatabaseSync(
        path.join(snapshot.root, "workspace.sqlite"),
        { readOnly: true },
      );
      try {
        return JSON.parse(
          db.prepare("SELECT metadata FROM papers WHERE id=?").get(paperId)
            .metadata,
        );
      } finally {
        db.close();
      }
    }
    const html = fs.readFileSync(
      "tests/fixtures/ieee-metadata-observed.html",
      "utf8",
    );
    const expected = JSON.parse(
      /xplGlobal\.document\.metadata\s*=\s*(\{[^\r\n]*\})\s*;/.exec(html)[1],
    );
    const workspace = await call("create_workspace", {
      name: "Metadata regression verification",
    });
    await call("switch_workspace", { id: workspace.id });
    const article = await context.newPage();
    await article.route("https://ieeexplore.ieee.org/document/726791", (r) =>
      r.fulfill({ contentType: "text/html", body: html }),
    );
    await article.goto("https://ieeexplore.ieee.org/document/726791");
    const popup = await popupFor(article, expected.title);
    await popup.getByLabel("Destination workspace").selectOption(workspace.id);
    let imported;
    await check(
      "Metadata fixture: real Chrome preview and native SQLite contain the complete extracted record",
      async () => {
        await expect(popup.getByLabel("Paper DOI")).toHaveValue(expected.doi);
        await expect(popup.getByLabel("Publication venue")).toHaveValue(
          expected.publicationTitle,
        );
        await expect(
          popup.getByLabel("Publisher", { exact: true }),
        ).toHaveValue("IEEE");
        await expect(popup.getByLabel("Publication date")).toHaveValue(
          "November 1998",
        );
        await expect(popup.getByLabel("Paper abstract")).toHaveValue(
          expected.abstract,
        );
        await popup
          .getByRole("button", { name: "Confirm paper import", exact: true })
          .click();
        await expect(popup.getByRole("status")).toContainText("Paper saved");
        const s = await call("snapshot");
        imported = s.papers.find((p) => p.ieee === "726791");
        const raw = stored(s, imported.id);
        expect(raw).toMatchObject({
          title: expected.title,
          authors: expected.authors.map((a) => a.name),
          doi: expected.doi.toLowerCase(),
          year: 1998,
          publicationDate: "November 1998",
          journal: "Proceedings of the IEEE",
          publisher: "IEEE",
          abstract: expected.abstract,
          keywords: expected.keywords.flatMap((g) => g.kwd),
          citationCount: 49111,
        });
        expect(JSON.stringify(raw)).not.toContain("MUST_NOT_LEAK");
      },
    );
    await check(
      "Metadata fixture: Paper Inspector renders authors, DOI, date, venue, abstract and keywords",
      async () => {
        await app.reload();
        await expect(app.locator(".application")).toBeVisible();
        await app.getByLabel("Search local papers").fill(expected.title);
        await app.locator(".search-results button").first().click();
        await expect(app.locator(".inspector-title p")).toHaveText(
          expected.authors.map((a) => a.name).join(", "),
        );
        await expect(app.locator(".inspector-title .paper-meta")).toContainText(
          "Proceedings of the IEEE",
        );
        await expect(app.locator(".inspector .abstract")).toHaveText(
          expected.abstract,
        );
        await expect(
          app.locator(".inspector dd").filter({ hasText: expected.doi }),
        ).toHaveText(expected.doi);
        await expect(
          app.locator(".inspector dd").filter({ hasText: "November 1998" }),
        ).toHaveText("November 1998");
        await expect(
          app.locator(".inspector dd").filter({ hasText: "Neural networks" }),
        ).toContainText("Convolutional Network");
        await app
          .locator(".inspector dd")
          .filter({ hasText: "Neural networks" })
          .scrollIntoViewIfNeeded();
        await app.screenshot({
          path: path.join(proof, "metadata-inspector.png"),
        });
        await popup.screenshot({
          path: path.join(proof, "metadata-extension.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Metadata fixture: duplicate enrichment fills missing fields and preserves notes, corrections, status, tags, layout and edges",
      async () => {
        const note = await call("read_note", { id: imported.id });
        await call("save_note", {
          id: imported.id,
          content: "Personal note فارسی α²",
          revision: note.revision,
        });
        const corrected = {
          ...imported,
          title: "My corrected scientific title",
          status: "read",
          tags: ["Personal"],
          x: 345,
          y: -120,
          pinned: true,
          hidden: true,
          authors: [],
          doi: "",
          year: null,
          publicationDate: "",
          journal: "",
          publisher: "",
          abstract: "",
          keywords: [],
          citationCount: 7,
        };
        await call("save_paper", { paper: corrected });
        const neighbor = {
          ...imported,
          id: crypto.randomUUID(),
          doi: "10.1234/neighbor",
          ieee: "",
          title: "Existing neighbor",
        };
        const saved = await call("save_paper", { paper: neighbor });
        await call("save_citation", { citing: imported.id, cited: saved.id });
        await popup
          .getByRole("button", { name: "Read paper metadata", exact: true })
          .click();
        await expect(popup.getByLabel("Paper DOI")).toHaveValue(expected.doi);
        await popup
          .getByRole("button", { name: "Confirm paper import", exact: true })
          .click();
        await expect(popup.getByRole("status")).toContainText("Paper saved");
        const s = await call("snapshot"),
          p = s.papers.find((p) => p.ieee === "726791");
        expect(p).toMatchObject({
          id: imported.id,
          title: corrected.title,
          status: "read",
          tags: ["Personal"],
          x: 345,
          y: -120,
          pinned: true,
          hidden: true,
          authors: expected.authors.map((a) => a.name),
          doi: expected.doi,
          abstract: expected.abstract,
          keywords: expected.keywords.flatMap((g) => g.kwd),
          citationCount: 7,
        });
        expect(s.papers).toHaveLength(2);
        expect(s.citations).toHaveLength(1);
        expect((await call("read_note", { id: imported.id })).content).toBe(
          "Personal note فارسی α²",
        );
      },
    );
    await check(
      "Metadata fixture: intentional title-only import still succeeds with an honest partial warning",
      async () => {
        const titleOnly = await context.newPage();
        await titleOnly.route(
          "https://ieeexplore.ieee.org/document/777777",
          (r) =>
            r.fulfill({
              contentType: "text/html",
              body: '<meta name="og:title" content="Intentional title-only paper">',
            }),
        );
        await titleOnly.goto("https://ieeexplore.ieee.org/document/777777");
        const partial = await popupFor(
          titleOnly,
          "Intentional title-only paper",
        );
        await partial
          .getByLabel("Destination workspace")
          .selectOption(workspace.id);
        await expect(
          partial.getByText(/Only the paper title could be extracted/),
        ).toBeVisible();
        await partial
          .getByRole("button", { name: "Confirm paper import", exact: true })
          .click();
        await expect(partial.getByRole("status")).toContainText("Paper saved");
        const p = (await call("snapshot")).papers.find(
          (p) => p.ieee === "777777",
        );
        expect(p.title).toBe("Intentional title-only paper");
        expect(p.authors).toEqual([]);
        expect(p.year).toBeNull();
      },
    );
    if (process.env.YARA_SKIP_LIVE === "1") {
      const prior = path.join(proof, "live-ieee-metadata.json");
      if (fs.existsSync(prior))
        live.push(
          ...JSON.parse(fs.readFileSync(prior, "utf8")).map((result) => ({
            ...result,
            priorAttemptRetained: true,
          })),
        );
      return live;
    }
    const liveWorkspace = await call("create_workspace", {
      name: "Live IEEE metadata verification",
    });
    await call("switch_workspace", { id: liveWorkspace.id });
    const known = [
      ["726791", "10.1109/5.726791", "1998", 4],
      ["9983528", "10.1109/TIM.2022.3227990", "2023", 6],
      ["10818533", "10.1109/TWC.2024.3520870", "2025", 6],
      ["7780459", "10.1109/CVPR.2016.90", "2016", 4],
    ];
    for (const [articleId, knownDoi, knownYear, knownAuthors] of known) {
      const livePage = await context.newPage();
      const url = `https://ieeexplore.ieee.org/document/${articleId}`;
      let source;
      try {
        await livePage.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await livePage.waitForFunction(
          () =>
            Array.from(document.scripts).some((s) =>
              (s.textContent || "").includes("xplGlobal.document.metadata"),
            ),
          undefined,
          { timeout: 10000 },
        );
        source = await livePage.evaluate(() => {
          const script =
            Array.from(document.scripts)
              .map((s) => s.textContent || "")
              .find((s) => s.includes("xplGlobal.document.metadata")) || "";
          const match =
            /xplGlobal\.document\.metadata\s*=\s*(\{[^\r\n]*\})\s*;/.exec(
              script,
            );
          if (!match)
            throw new Error(
              "Live source JSON is not recognizable for independent verification.",
            );
          const m = JSON.parse(match[1]);
          return {
            title: m.title,
            authors: m.authors.map((a) => a.name),
            doi: m.doi,
            year: m.publicationYear,
            date: m.publicationDate,
            journal: m.publicationTitle,
            publisher: m.publisher,
            abstract: m.abstract,
            keywords: m.keywords.flatMap((g) => g.kwd || []),
            visibleTitle: document
              .querySelector("h1.document-title")
              ?.textContent?.trim(),
          };
        });
      } catch (error) {
        live.push({ url, status: "unavailable", reason: String(error) });
        await livePage.close();
        continue;
      }
      await check(
        `Live IEEE ${articleId}: source values match real extension preview, SQLite and Paper Inspector`,
        async () => {
          expect(source.doi.toLowerCase()).toBe(knownDoi.toLowerCase());
          expect(String(source.year)).toBe(knownYear);
          expect(source.authors).toHaveLength(knownAuthors);
          expect(source.visibleTitle).toBe(source.title);
          const livePopup = await popupFor(livePage, source.title);
          await livePopup
            .getByLabel("Destination workspace")
            .selectOption(liveWorkspace.id);
          await expect(livePopup.getByLabel("Paper DOI")).toHaveValue(
            source.doi.toLowerCase(),
          );
          await expect(livePopup.getByLabel("Publication venue")).toHaveValue(
            source.journal,
          );
          await expect(livePopup.getByLabel("Paper abstract")).toHaveValue(
            source.abstract,
          );
          await livePopup
            .getByRole("button", { name: "Confirm paper import", exact: true })
            .click();
          await expect(livePopup.getByRole("status")).toContainText(
            "Paper saved",
          );
          const s = await call("snapshot"),
            p = s.papers.find((p) => p.ieee === articleId),
            raw = stored(s, p.id);
          const keywords = source.keywords.filter(
            (v, i, all) =>
              all.findIndex(
                (k) => k.toLocaleLowerCase() === v.toLocaleLowerCase(),
              ) === i,
          );
          expect(raw).toMatchObject({
            title: source.title,
            authors: source.authors,
            doi: source.doi.toLowerCase(),
            year: Number(source.year),
            publicationDate: source.date,
            journal: source.journal,
            publisher: source.publisher,
            abstract: source.abstract,
            keywords,
          });
          await app.reload();
          await expect(app.locator(".application")).toBeVisible();
          await app.getByLabel("Search local papers").fill(source.title);
          await app.locator(".search-results button").first().click();
          await expect(app.locator(".inspector .abstract")).toHaveText(
            source.abstract,
          );
          await expect(app.locator(".inspector-title p")).toHaveText(
            source.authors.join(", "),
          );
          await expect(
            app
              .locator(".inspector dd")
              .filter({ hasText: source.doi.toLowerCase() }),
          ).toBeAttached();
          live.push({
            url,
            status: "verified end to end in Chrome",
            title: source.title,
            doi: source.doi,
            year: source.year,
            date: source.date,
            venue: source.journal,
            authors: source.authors,
            keywordCount: keywords.length,
            abstractCharacters: raw.abstract.length,
            abstractSha256: crypto
              .createHash("sha256")
              .update(raw.abstract)
              .digest("hex"),
          });
        },
      );
      await livePage.close();
    }
    return live;
  } finally {
    await context.close();
    fs.writeFileSync(
      path.join(proof, "live-ieee-metadata.json"),
      JSON.stringify(live, null, 2),
    );
  }
}
