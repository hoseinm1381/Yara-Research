import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root = process.cwd();
const data = path.join(root, ".tooling", "native-proof", crypto.randomUUID());
fs.mkdirSync(data, { recursive: true });
const proof = path.join(root, "docs", "evidence-v1.1.1");
fs.mkdirSync(proof, { recursive: true });
const report = {
  kind: "Native Windows Tauri / WebView2 smoke test",
  data,
  checks: [],
  liveOpenAlex: [],
  errors: [],
};
const exe = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  "yara-research.exe",
);
let child, browser, page;
async function start() {
  child = spawn(exe, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      YARA_DATA_DIR: data,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1",
      WEBVIEW2_USER_DATA_FOLDER: path.join(data, "webview"),
    },
  });
  child.on("error", (e) => report.errors.push(String(e)));
  child.stdout?.on("data", (bytes) => console.log(String(bytes)));
  child.stderr?.on("data", (bytes) => console.error(String(bytes)));
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null)
      throw new Error(
        `Native process exited before opening its webview (code ${child.exitCode}).`,
      );
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser)
    throw new Error("Native WebView2 debugging port did not become available.");
  for (let i = 0; i < 30; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (page) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!page) throw new Error("Native webview page was not available.");
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(page.locator(".application")).toBeVisible();
}
async function stop() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  if (child && !child.killed && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once("exit", r));
  }
  child = null;
}
async function call(cmd, args = {}) {
  return page.evaluate(
    ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
}
async function check(name, fn) {
  await fn();
  report.checks.push(name);
  console.log("PASS", name);
}
try {
  await start();
  await check("Native main window opens and uses SQLite", async () => {
    const s = await call("snapshot");
    expect(s.root).toContain(data);
    expect(fs.existsSync(path.join(s.root, "workspace.sqlite"))).toBe(true);
  });
  await page.getByRole("button", { name: "Add Paper", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Add Paper Manually", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Paper title").fill("Native research پژوهش 科学");
  await d
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("core");
  await d.getByLabel("DOI", { exact: true }).fill("10.1234/native-smoke");
  await d.getByRole("button", { name: "Save paper", exact: true }).click();
  await check("UI creates a paper through real native IPC", async () => {
    await expect(page.locator(".inspector h2")).toHaveText(
      "Native research پژوهش 科学",
    );
    expect((await call("snapshot")).papers).toHaveLength(1);
  });
  const first = (await call("snapshot")).papers[0];
  await page.getByLabel("Paper status", { exact: true }).selectOption("read");
  await check("Status color persists through SQLite", async () => {
    await expect(page.getByTestId("paper-node")).toHaveClass(/read/);
    expect((await call("snapshot")).papers[0].status).toBe("read");
  });
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(/Native research/);
  await page
    .getByLabel("Markdown note")
    .fill("# Native note\n\nPersistent فارسی 科学");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("Markdown note saved")).toBeVisible();
  await check("Notes save real UTF-8 Markdown files", async () => {
    const s = await call("snapshot");
    expect(
      fs.readFileSync(path.join(s.root, "notes", `${first.id}.md`), "utf8"),
    ).toContain("Persistent فارسی 科学");
  });
  await check("External editor changes reload safely", async () => {
    const s = await call("snapshot");
    fs.writeFileSync(
      path.join(s.root, "notes", `${first.id}.md`),
      "# Externally edited\n\nChanged on disk",
      "utf8",
    );
    await expect(page.getByLabel("Markdown note")).toHaveValue(
      /Changed on disk/,
      { timeout: 8000 },
    );
  });
  await check(
    "Conflicting edits cannot overwrite an external change",
    async () => {
      await page.getByLabel("Markdown note").fill("Unsaved local edit");
      const s = await call("snapshot");
      fs.writeFileSync(
        path.join(s.root, "notes", `${first.id}.md`),
        "Newest external version",
        "utf8",
      );
      await expect(
        page.getByText(
          "This file changed outside Yara. Copy your unsaved text before reloading.",
        ),
      ).toBeVisible({ timeout: 8000 });
      expect((await call("read_note", { id: first.id })).content).toBe(
        "Newest external version",
      );
    },
  );
  await check("Native Cancel keeps unsaved note text", async () => {
    await page.getByTitle("Reload from disk", { exact: true }).click();
    await page
      .getByRole("button", { name: "Cancel action", exact: true })
      .click();
    await expect(page.getByLabel("Markdown note")).toHaveValue(
      "Unsaved local edit",
    );
  });
  await page.getByTitle("Reload from disk", { exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(
    "Newest external version",
  );
  await check("Pin and graph coordinates persist", async () => {
    const p = (await call("snapshot")).papers[0];
    await call("save_paper", { paper: { ...p, pinned: true } });
    await call("save_position", { id: first.id, x: 321, y: -123 });
    expect((await call("snapshot")).papers[0]).toMatchObject({
      x: 321,
      y: -123,
      pinned: true,
    });
  });
  await check("Duplicate DOI imports preserve existing research", async () => {
    const p = (await call("snapshot")).papers[0];
    const result = await call("import_papers", {
      papers: [
        {
          ...p,
          id: crypto.randomUUID(),
          title: "Provider replacement",
          status: "unreviewed",
          x: 0,
          y: 0,
        },
      ],
      anchor: null,
      direction: null,
    });
    expect(result[0].id).toBe(first.id);
    expect((await call("snapshot")).papers[0]).toMatchObject({
      title: first.title,
      status: "read",
      x: 321,
    });
  });
  let second;
  await check("Shared citations keep one node and two edges", async () => {
    const p = (await call("snapshot")).papers[0];
    const b = {
      ...p,
      id: crypto.randomUUID(),
      title: "Second core",
      doi: "10.1234/second",
      status: "core",
      x: 700,
    };
    second = await call("save_paper", { paper: b });
    const c = {
      ...p,
      id: crypto.randomUUID(),
      title: "Shared citing work",
      doi: "10.1234/shared",
      status: "candidate",
      x: 1100,
    };
    const other = await call("save_paper", { paper: c });
    await call("save_citation", { citing: other.id, cited: first.id });
    await call("save_citation", { citing: other.id, cited: second.id });
    await call("save_citation", { citing: other.id, cited: second.id });
    expect((await call("snapshot")).citations).toHaveLength(2);
  });
  await check(
    "Backup restores a complete, separate validated workspace",
    async () => {
      const target = path.join(data, "test-backup.yara");
      await call("export_backup", { path: target });
      const before = await call("snapshot");
      const after = await call("restore_backup", { path: target });
      expect(after.papers).toHaveLength(3);
      expect(after.citations).toHaveLength(2);
      expect(after.root).not.toBe(before.root);
      expect(fs.existsSync(path.join(before.root, "workspace.sqlite"))).toBe(
        true,
      );
      expect((await call("read_note", { id: first.id })).content).toBe(
        "Newest external version",
      );
    },
  );
  await check(
    "Corrupt restore leaves the active workspace intact",
    async () => {
      const bad = path.join(data, "bad.yara");
      fs.writeFileSync(bad, "not a zip");
      const before = await call("snapshot");
      let rejected = false;
      try {
        await call("restore_backup", { path: bad });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      expect((await call("snapshot")).root).toBe(before.root);
    },
  );
  await check(
    "VS Code launch or a verified missing-editor response",
    async () => {
      await call("set_setting", {
        key: "vscode",
        value: path.join(data, "missing", "Code.exe"),
      });
      try {
        report.editor = await call("open_note", {
          id: first.id,
          editor: "vscode",
        });
      } catch (e) {
        expect(String(e)).toContain("VS Code");
        report.editor = String(e);
      }
    },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Focus a core paper", exact: true })
    .count()
    .catch(() => 0);
  await page.screenshot({ path: path.join(proof, "native-dark.png") });
  await stop();
  await start();
  await check(
    "Full native restart preserves workspace and external notes",
    async () => {
      const s = await call("snapshot");
      expect(s.papers).toHaveLength(3);
      expect(s.citations).toHaveLength(2);
      expect(s.papers.find((p) => p.id === first.id)).toMatchObject({
        x: 321,
        y: -123,
        pinned: true,
        status: "read",
      });
      expect((await call("read_note", { id: first.id })).content).toBe(
        "Newest external version",
      );
    },
  );
  for (const q of [
    { mode: "search", term: "10.1038/nature14539" },
    { mode: "search", term: "https://openalex.org/W2741809807" },
    { mode: "citing", term: "https://openalex.org/W2741809807" },
    { mode: "references", term: "https://openalex.org/W2741809807" },
  ]) {
    try {
      const r = await call("discover", {
        query: { ...q, page: 1, refresh: true },
      });
      report.liveOpenAlex.push({
        mode: q.mode,
        term: q.term,
        count: r.count,
        received: r.papers.length,
        cached: r.cached,
      });
    } catch (e) {
      report.liveOpenAlex.push({ mode: q.mode, error: String(e) });
    }
  }
  await check(
    "Native SQLite stores more than 3000 papers with Markdown files",
    async () => {
      const p = (await call("snapshot")).papers[0];
      const start = Date.now();
      for (let batch = 0; batch < 6; batch++) {
        const papers = Array.from({ length: 500 }, (_, i) => ({
          ...p,
          id: crypto.randomUUID(),
          title: `Storage fixture ${batch * 500 + i + 1}`,
          doi: "",
          openalex: "",
          source: "Storage test fixture",
          status: "unreviewed",
          pinned: false,
          hasNote: false,
          x: (i % 25) * 340,
          y: Math.floor(i / 25) * 190,
        }));
        await call("import_papers", { papers, anchor: null, direction: null });
      }
      const insertMs = Date.now() - start;
      const snapshotStart = Date.now();
      const s = await call("snapshot");
      expect(s.papers).toHaveLength(3003);
      report.storagePerformance = {
        papers: s.papers.length,
        insert3000Ms: insertMs,
        snapshotMs: Date.now() - snapshotStart,
        sqliteBytes: fs.statSync(path.join(s.root, "workspace.sqlite")).size,
      };
    },
  );
  await check(
    "Native window close protects unsaved notes and respects Cancel",
    async () => {
      await page.getByLabel("Search local papers").fill("Native research");
      await page.locator(".search-results button").first().click();
      await page.getByRole("button", { name: "Notes", exact: true }).click();
      await expect(page.getByLabel("Markdown note")).toHaveValue(
        "Newest external version",
      );
      await page.getByLabel("Markdown note").fill("Unsaved close test");
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          path.join(root, "scripts/request-close.ps1"),
          "-NativeProcessId",
          String(child.pid),
        ],
        { windowsHide: true },
      );
      await page
        .getByRole("button", { name: "Cancel action", exact: true })
        .click();
      await expect(page.getByLabel("Markdown note")).toHaveValue(
        "Unsaved close test",
      );
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-File",
          path.join(root, "scripts/request-close.ps1"),
          "-NativeProcessId",
          String(child.pid),
        ],
        { windowsHide: true },
      );
      await page
        .getByRole("button", { name: "Confirm action", exact: true })
        .click();
      await new Promise((resolve, reject) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(
          () => reject(new Error("Approved native close did not exit.")),
          8000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await browser.close().catch(() => {});
      browser = null;
      child = null;
    },
  );
  expect(report.errors).toEqual([]);
  report.completed = true;
} catch (e) {
  report.errors.push(String(e));
  console.error(e);
  process.exitCode = 1;
} finally {
  await stop();
  fs.writeFileSync(
    path.join(proof, "native-smoke.json"),
    JSON.stringify(report, null, 2),
  );
}
