/* global chrome, document */
import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { verifyMetadata } from "./verify-metadata.mjs";

// Real browsers -> compiled stdio host -> real SQLite -> release Tauri window.
// The IEEE HTML is a saved fixture, deliberately not claimed as live IEEE proof.
const root = process.cwd(),
  id = fs.readFileSync("extension/extension-id.txt", "utf8").trim();
const run = crypto.randomUUID(),
  data = path.join(root, ".tooling", "extension-native-proof", run);
const proof = path.join(root, "docs", "evidence-v1.1.1");
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(proof, { recursive: true });
const manifest = path.join(data, "native-host.json"),
  registry = path.join(data, "registry-before.json");
fs.writeFileSync(
  manifest,
  JSON.stringify({
    name: "org.yara.research",
    description: "Yara isolated verification",
    path: path.join(
      root,
      "src-tauri",
      "target",
      "release",
      "yara-native-host.exe",
    ),
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  }),
);
const report = {
  appSha256: crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        path.join(root, "src-tauri", "target", "release", "yara-research.exe"),
      ),
    )
    .digest("hex"),
  hostSha256: crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        path.join(
          root,
          "src-tauri",
          "target",
          "release",
          "yara-native-host.exe",
        ),
      ),
    )
    .digest("hex"),
  kind: "Real browser Native Messaging / release Tauri integration with saved IEEE fixture",
  data,
  browsers: [],
  checks: [],
  errors: [],
};
let child,
  native,
  app,
  context,
  registered = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (cmd, args = {}) =>
  app.evaluate(
    ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
const check = async (name, fn) => {
  await fn();
  report.checks.push(name);
  console.log("PASS", name);
};
const registration = (mode) =>
  execFileSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      "scripts/native-host-test-registration.ps1",
      "-Mode",
      mode,
      "-Manifest",
      manifest,
      "-State",
      registry,
    ],
    { cwd: root, windowsHide: true, stdio: "pipe" },
  );
async function start() {
  child = spawn(
    path.join(root, "src-tauri", "target", "release", "yara-research.exe"),
    [],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        YARA_DATA_DIR: data,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
          "--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1",
        WEBVIEW2_USER_DATA_FOLDER: path.join(data, "webview"),
      },
    },
  );
  child.on("error", (e) => report.errors.push(String(e)));
  for (let i = 0; i < 60; i++) {
    try {
      native = await chromium.connectOverCDP("http://127.0.0.1:9224");
      break;
    } catch {
      await pause(500);
    }
  }
  if (!native) throw new Error("Native window did not start");
  app = native.contexts()[0].pages()[0];
  await expect(app.locator(".application")).toBeVisible();
}
async function openAction(cdp, article) {
  await article.bringToFront();
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{}] });
  const target = targetInfos.find(
    (t) => t.type === "tab" && t.url === article.url(),
  );
  if (!target) throw new Error("Article tab target unavailable");
  await cdp.send("Extensions.triggerAction", { id, targetId: target.targetId });
  // The browser action grants activeTab. Open the same extension UI as a background
  // tab for stable Playwright inspection; its active article and permissions remain real.
  await cdp.send("Target.createTarget", {
    url: `chrome-extension://${id}/popup.html`,
    background: true,
  });
  await expect
    .poll(
      () =>
        context
          .pages()
          .filter((p) => p.url().startsWith(`chrome-extension://${id}/`))
          .length,
    )
    .toBeGreaterThan(0);
  const popup = context
    .pages()
    .find((p) => p.url().startsWith(`chrome-extension://${id}/`));
  await expect(popup.getByLabel("Focal paper title")).toHaveValue(
    "Fixture focal research",
  );
  return popup;
}
try {
  await start();
  const main = (await call("snapshot")).workspace;
  await call("rename_workspace", { name: "Primary fixture workspace" });
  const other = await call("create_workspace", {
    name: "Extension destination",
  });
  registration("Register");
  registered = true;
  const channels = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["msedge", "chrome"];
  for (const channel of channels) {
    const settings =
      channel === "chrome-testing"
        ? {
            executablePath: path.join(
              root,
              ".tooling",
              "chrome-for-testing",
              "chrome-win64",
              "chrome.exe",
            ),
          }
        : { channel };
    context = await chromium.launchPersistentContext(
      path.join(data, "profile-" + channel),
      {
        ...settings,
        headless: true,
        env: { ...process.env, YARA_DATA_DIR: data },
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          `--load-extension=${path.join(root, ".tooling", "extension-build")}`,
          "--enable-unsafe-extension-debugging",
        ],
      },
    );
    report.browsers.push({ channel, version: context.browser().version() });
    const cdp = await context.browser().newBrowserCDPSession();
    const article = context.pages()[0];
    if (channel === "chrome") {
      // Branded Chrome requires Developer mode for unpacked extensions. This changes
      // only the newly created test profile, never the user's ordinary profile.
      await article.goto("chrome://extensions");
      await article.evaluate(() =>
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
    }
    await article.route("https://ieeexplore.ieee.org/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: fs.readFileSync("tests/fixtures/ieee-article.html", "utf8"),
      }),
    );
    await article.goto("https://ieeexplore.ieee.org/document/726791");
    let popup = await openAction(cdp, article);
    const send = (message) =>
      popup.evaluate(
        (m) => chrome.runtime.sendNativeMessage("org.yara.research", m),
        message,
      );
    await check(
      `${channel}: real host lists both actual named workspaces`,
      async () => {
        await expect(
          popup.getByRole("option", { name: /Primary fixture workspace/ }),
        ).toBeAttached();
        await expect(
          popup.getByRole("option", { name: /Extension destination/ }),
        ).toBeAttached();
      },
    );
    await popup.getByLabel("Destination workspace").selectOption(other.id);
    await check(
      `${channel}: reviewed active-tab metadata imports only into chosen workspace`,
      async () => {
        await popup
          .getByRole("button", { name: "Confirm paper import", exact: true })
          .click();
        await expect(popup.getByRole("status")).toContainText("Paper saved");
        expect((await call("snapshot")).papers).toHaveLength(0);
        await call("switch_workspace", { id: other.id });
        const s = await call("snapshot");
        expect(s.papers).toHaveLength(1);
        expect(s.papers[0].ieee).toBe("726791");
        await expect(app.getByLabel("Choose workspace")).toHaveAttribute(
          "title",
          "Extension destination",
          { timeout: 10000 },
        );
        await app.getByLabel("Search local papers").fill("Fixture focal");
        await expect(
          app.locator(".search-results button").first(),
        ).toContainText("Fixture focal research");
        await app.getByLabel("Search local papers").fill("");
      },
    );
    const f = (await call("snapshot")).papers[0];
    await check(
      `${channel}: metadata provenance grants no relationship evidence`,
      async () => {
        if (channel === channels[0])
          expect(
            await call("relationship_evidence", {
              id: f.id,
              direction: "references",
            }),
          ).toHaveLength(0);
        expect(await call("metadata_sources", { id: f.id })).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ provider: "IEEE" }),
          ]),
        );
      },
    );
    await check(
      `${channel}: explicit References capture persists three entries without automatic graph imports`,
      async () => {
        await popup
          .getByRole("button", {
            name: "Capture loaded references",
            exact: true,
          })
          .click();
        await expect(
          popup.getByText("3 selected / 3 captured", { exact: false }),
        ).toBeVisible();
        await popup
          .getByRole("button", { name: "Confirm IEEE capture", exact: true })
          .click();
        await expect(popup.getByRole("status")).toContainText(
          "IEEE evidence saved",
        );
        const evidence = await call("relationship_evidence", {
          id: f.id,
          direction: "references",
        });
        expect(evidence[0].items).toHaveLength(3);
        expect(evidence[0].coverage).toBe("complete");
        expect((await call("snapshot")).papers).toHaveLength(1);
        const count = evidence.length;
        await popup
          .getByRole("button", { name: "Confirm IEEE capture", exact: true })
          .click();
        await expect(popup.getByRole("status")).toBeVisible();
        expect(
          await call("relationship_evidence", {
            id: f.id,
            direction: "references",
          }),
        ).toHaveLength(count);
      },
    );
    await check(
      `${channel}: Citing capture has separate partial coverage`,
      async () => {
        await popup
          .getByRole("button", {
            name: "Capture loaded citing papers",
            exact: true,
          })
          .click();
        await expect(
          popup.getByText("1 selected / 1 captured", { exact: false }),
        ).toBeVisible();
        await popup
          .getByRole("button", { name: "Confirm IEEE capture", exact: true })
          .click();
        await expect(popup.getByRole("status")).toContainText(
          "IEEE evidence saved",
        );
        const evidence = await call("relationship_evidence", {
          id: f.id,
          direction: "citing",
        });
        expect(evidence[0].coverage).toBe("partial");
        expect(evidence[0].total).toBe(9);
        expect(evidence[0].items[0].doi).toBe("10.1234/citing");
      },
    );
    await check(
      `${channel}: forged context, invalid workspace and malformed messages are rejected by compiled host`,
      async () => {
        const base = {
          version: 1,
          requestId: crypto.randomUUID(),
          action: "import_paper",
          workspaceId: other.id,
          paper: f,
          pageUrl: "https://example.com/document/726791",
          provider: "IEEE",
        };
        expect((await send(base)).ok).toBe(false);
        expect(
          (
            await send({
              ...base,
              requestId: crypto.randomUUID(),
              pageUrl: "https://ieeexplore.ieee.org/document/726791",
              workspaceId: crypto.randomUUID(),
            })
          ).ok,
        ).toBe(false);
        expect(
          (
            await send({
              version: 1,
              requestId: crypto.randomUUID(),
              action: "list_workspaces",
              execute: "arbitrary",
            })
          ).ok,
        ).toBe(false);
      },
    );
    await check(
      `${channel}: unrecognized section supports an official export without erasing earlier evidence`,
      async () => {
        await article.evaluate(() =>
          document.getElementById("references")?.remove(),
        );
        await popup
          .getByRole("button", {
            name: "Capture loaded references",
            exact: true,
          })
          .click();
        await expect(popup.getByText(/could not be recognized/)).toBeVisible();
        await popup
          .getByText("Use an official BibTeX / RIS export instead", {
            exact: true,
          })
          .click();
        await popup
          .getByLabel("Official citation export")
          .fill(
            "@article{export, title={Official export fixture}, doi={10.1234/export}, year={2022}}",
          );
        await popup
          .getByRole("button", { name: "Review exported entries", exact: true })
          .click();
        await expect(
          popup.getByRole("checkbox", { name: /^Official export fixture/ }),
        ).toBeVisible();
        await popup.getByLabel("Capture coverage").selectOption("partial");
        await popup
          .getByRole("button", { name: "Confirm IEEE capture", exact: true })
          .click();
        await expect(popup.getByRole("status")).toContainText(
          "IEEE evidence saved",
        );
        const evidence = await call("relationship_evidence", {
          id: f.id,
          direction: "references",
        });
        expect(evidence[0].method).toContain(
          "User-provided official BibTeX / RIS export",
        );
        expect(evidence[0].items[0].doi).toBe("10.1234/export");
        expect(
          evidence.some(
            (e) => e.coverage === "complete" && e.items.length === 3,
          ),
        ).toBe(true);
      },
    );
    await popup.screenshot({
      path: path.join(proof, `extension-${channel}.png`),
      fullPage: true,
    });
    await context.close();
    context = null;
    await call("switch_workspace", { id: main.id });
  }
  await call("switch_workspace", { id: other.id });
  await app.reload();
  await expect(app.locator(".application")).toBeVisible();
  const f = (await call("snapshot")).papers[0];
  await check(
    "Native comparison displays retained IEEE-only rows and accessible independent badges",
    async () => {
      await app.getByLabel("Search local papers").fill("Fixture focal");
      await app.locator(".search-results button").first().click();
      await app
        .getByRole("button", { name: "Find Referenced Papers", exact: true })
        .click();
      await expect(
        app.getByText("IEEE-only related work", { exact: true }),
      ).toBeVisible();
      await expect(app.locator(".source-badge").first()).toBeVisible();
      await app.screenshot({
        path: path.join(proof, "native-ieee-comparison.png"),
      });
      await app.getByRole("button", { name: "Close", exact: true }).click();
    },
  );
  await check(
    "Deliberate IEEE import stores canonical focal-to-reference edge and metadata source",
    async () => {
      const evidence = await call("relationship_evidence", {
        id: f.id,
        direction: "references",
      });
      const related = evidence
        .flatMap((e) => e.items)
        .find((p) => p.doi === "10.1234/c");
      const [saved] = await call("import_papers", {
        papers: [related],
        anchor: f.id,
        direction: "references",
      });
      const s = await call("snapshot");
      expect(s.citations).toContainEqual(
        expect.objectContaining({
          citing: f.id,
          cited: saved.id,
          source: "IEEE",
          verified: true,
        }),
      );
      expect(await call("metadata_sources", { id: saved.id })).toContainEqual(
        expect.objectContaining({ provider: "IEEE" }),
      );
    },
  );
  await check(
    "Source evidence and selected workspace survive a full native process restart",
    async () => {
      await native.close();
      native = null;
      child.kill();
      await new Promise((r) => child.once("exit", r));
      child = null;
      await start();
      const s = await call("snapshot");
      expect(s.workspace.id).toBe(other.id);
      expect(
        (
          await call("relationship_evidence", {
            id: f.id,
            direction: "references",
          })
        ).length,
      ).toBe(channels.length * 2);
      expect(
        (await call("relationship_evidence", { id: f.id, direction: "citing" }))
          .length,
      ).toBe(channels.length);
    },
  );
  report.liveIeee = await verifyMetadata({ app, call, data, proof, check });
  report.completed = true;
} catch (e) {
  report.errors.push(e.stack || String(e));
  console.error(e);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await native?.close().catch(() => {});
  child?.kill();
  if (registered) {
    try {
      registration("Restore");
      report.registryRestored = true;
    } catch (e) {
      report.errors.push(String(e));
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(
    path.join(proof, "extension-native-smoke.json"),
    JSON.stringify(report, null, 2),
  );
}
