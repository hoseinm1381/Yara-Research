import { test, expect } from "@playwright/test";
async function action(page:import("@playwright/test").Page,name:string){await page.getByRole("button",{name:"Add Paper",exact:true}).click();await page.getByRole("menuitem",{name,exact:true}).click();}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Start with one paper.")).toBeVisible();
});
test("unsaved note confirmation preserves text on Cancel and reloads only on Confirm", async ({
  page,
}) => {
  await add(page, "Confirmations");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(/Confirmations/);
  await page.getByLabel("Markdown note").fill("Unsaved important text");
  await page.getByLabel("Close inspector", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm your action", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(
    "Unsaved important text",
  );
  await page.getByTitle("Reload from disk", { exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(/# Confirmations/);
});
test("demo reset is deliberate and leaves an empty workspace", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Or explore a demonstration graph" })
    .click();
  await page
    .getByRole("button", { name: "Settings & backups", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset demo dataset", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).papers.length)).toBe(6);
  await page
    .getByRole("button", { name: "Reset demo dataset", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(page.getByText("Start with one paper.")).toBeVisible();
});
async function add(
  page: import("@playwright/test").Page,
  title: string,
  status = "candidate",
) {
  await action(page,"Add Paper Manually");
  const d = page.getByRole("dialog");
  await d.getByLabel("Paper title").fill(title);
  await d.getByLabel("Publication year", { exact: true }).fill("2024");
  await d
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption(status);
  await d.getByRole("button", { name: "Save paper", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(page.locator(".inspector h2")).toHaveText(title);
}
test("manual creation, status, notes, dragging, pinning and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await add(page, "پژوهش Science 科学", "core");
  await expect(page.getByTestId("paper-node")).toHaveCount(1);
  await page.getByLabel("Paper status").selectOption("read");
  await expect(page.getByTestId("paper-node")).toHaveClass(/read/);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toContainText("پژوهش");
  await page
    .getByLabel("Markdown note")
    .fill("# Findings\n\nUnicode فارسی 科学\n\n- [ ] Follow up");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("Markdown note saved")).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".markdown h1")).toHaveText("Findings");
  await page.reload();
  await page.getByTestId("paper-node").click();
  await expect(page.locator(".inspector h2")).toHaveText("پژوهش Science 科学");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(
    /Unicode فارسی 科学/,
  );
  await page.getByRole("button", { name: "Pin position", exact: true }).click();
  await expect(page.getByLabel("Pinned", { exact: true })).toBeVisible();
  await page.getByLabel("Close inspector", { exact: true }).click();
  const node = page.getByTestId("paper-node");
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 90, box.y + 45);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 115, { steps: 10 });
  await page.mouse.up();
  const before = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).papers[0],
  );
  await page.reload();
  const after = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).papers[0],
  );
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.pinned).toBe(true);
  expect(errors).toEqual([]);
});
test("shared citations, metadata edits and duplicate import", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Or explore a demonstration graph" })
    .click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).papers.length)).toBe(6);
  await page.getByTitle("Add citation connection", { exact: true }).click();
  const d = page.getByRole("dialog");
  const options = await d
    .getByLabel("Citing paper", { exact: true })
    .locator("option")
    .allTextContents();
  expect(options).toHaveLength(6);
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await action(page,"Import from Text");
  await page
    .getByLabel("Pasted bibliographic text")
    .fill(
      "@article{a,title={Duplicate attention},doi={10.48550/arxiv.1706.03762},year={2017}}",
    );
  await page.getByRole("button", { name: "Extract & review" }).click();
  await expect(
    page.getByText(/Already saved — preserve local edits/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 1 selected" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).papers.length)).toBe(6);
  await expect(page.locator(".inspector h2")).toHaveText(
    "Attention Is All You Need",
  );
});
test("paste IEEE, edit extracted fields, archive, hide and restore visibility", async ({
  page,
}) => {
  await action(page,"Import from Text");
  await page
    .getByLabel("Pasted bibliographic text")
    .fill(
      "J. Doe, “An IEEE scientific article,” IEEE Journal, 2021, doi: 10.1234/example.",
    );
  await page.getByRole("button", { name: "Extract & review" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Paper title")).toHaveValue(
    "An IEEE scientific article",
  );
  await d.getByLabel("Authors").fill("Jane Doe");
  await d.getByRole("button", { name: "Import 1 selected" }).click();
  await page.getByLabel("Paper status").selectOption("archived");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Hide archived", { exact: true }).check();
  await expect(page.getByText("No papers match these filters.")).toBeVisible();
  await page.getByLabel("Hide archived", { exact: true }).uncheck();
  await expect(page.getByTestId("paper-node")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("paper-node")).toHaveClass(/archived/);
});
test("dark and light populated layouts at minimum desktop size", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Or explore a demonstration graph" })
    .click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page
    .getByRole("button", { name: "Switch to light", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "test-results/graph-light-1366.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Switch to dark", exact: true })
    .click();
  await page.screenshot({ path: "test-results/graph-dark-1366.png" });
  await action(page,"Add Paper Manually");
  await page.screenshot({ path: "test-results/manual-dialog-dark.png" });
  await expect(
    page.getByRole("button", { name: "Save paper", exact: true }),
  ).toBeVisible();
});
test("offline saved research works and online failures are recoverable", async ({
  page,
  context,
}) => {
  await add(page, "Offline paper");
  await context.setOffline(true);
  await page.getByLabel("Paper status").selectOption("archived");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Markdown note").fill("Offline note saved");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await action(page,"Discover Papers");
  await page.getByLabel("OpenAlex query").fill("missing internet");
  await page
    .getByRole("button", { name: "Search OpenAlex", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).papers[0]
          .status,
    ),
  ).toBe("archived");
});
test("discovery preview, pagination, sorting, direction and existing connections with provider fixtures", async ({
  page,
}) => {
  const responses = [
    {
      id: "https://openalex.org/W1",
      title: "Seed",
      publication_year: 2017,
      referenced_works: ["https://openalex.org/W0"],
    },
    {
      id: "https://openalex.org/W2",
      title: "Citing work",
      publication_year: 2024,
      referenced_works: ["https://openalex.org/W1"],
    },
  ];
  await page.route("https://api.openalex.org/**", (route) => {
    const u = new URL(route.request().url());
    const citing = u.searchParams.get("filter")?.startsWith("cites:");
    return route.fulfill({
      json: {
        meta: { count: citing ? 51 : 1 },
        results: [responses[citing ? 1 : 0]],
      },
    });
  });
  await action(page,"Discover Papers");
  await page.getByLabel("OpenAlex query").fill("seed title");
  await page
    .getByRole("button", { name: "Search OpenAlex", exact: true })
    .click();
  await page.getByLabel("Select Seed", { exact: true }).check();
  await page.getByRole("button", { name: "Add 1 selected" }).click();
  await page
    .getByRole("button", { name: "Find Citing Papers", exact: true })
    .click();
  await page.getByLabel("Select Citing work", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Load next 50 results" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add 1 selected" }).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("yara-browser-preview-v1")!).citations.length)).toBe(1);
  const s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("yara-browser-preview-v1")!),
  );
  expect(s.citations[0].citing).toBe(
    s.papers.find((p: { title: string }) => p.title === "Citing work").id,
  );
  expect(s.citations[0].cited).toBe(
    s.papers.find((p: { title: string }) => p.title === "Seed").id,
  );
  expect(s.papers[1].x).toBeGreaterThan(s.papers[0].x);
});
