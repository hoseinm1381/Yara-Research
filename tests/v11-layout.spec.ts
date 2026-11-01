import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function state(page: Page) {
  return page
    .locator(".react-flow__viewport")
    .evaluate((el) => getComputedStyle(el).transform);
}
async function demo(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or explore a demonstration graph" })
    .click();
  await page.getByTitle("Fit graph to view", { exact: true }).click();
  await page.waitForTimeout(500);
}
async function action(page: Page, name: string) {
  await page.getByRole("button", { name: "Add Paper", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
test("headers are removed, Add Paper menu supports keyboard, outside click and existing workflows", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".workspace-heading")).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "Add Paper", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await trigger.click();
  await page.mouse.click(20, 20);
  await expect(page.getByRole("menu")).toBeHidden();
  for (const [name, heading] of [
    ["Add Paper Manually", "Add a paper"],
    ["Discover Papers", "Discover papers"],
    ["Import from Text", "Import from Pasted Text"],
  ]) {
    await action(page, name);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Close dialog", { exact: true }).click();
  }
  for (const name of [
    "All papers",
    "Core papers",
    "Candidate",
    "Read",
    "Archived",
    "With notes",
    "Research graph",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".workspace-heading")).toHaveCount(0);
    await expect(page.getByLabel("Search local papers")).toBeVisible();
  }
});
test("sidebar rail expands canvas, preserves navigation and survives restart", async ({
  page,
}) => {
  await demo(page);
  const before = await page.locator(".graph-container").boundingBox();
  const viewport = await state(page);
  await page.getByLabel("Collapse sidebar", { exact: true }).click();
  await expect
    .poll(async () =>
      Math.round((await page.locator(".sidebar").boundingBox())!.width),
    )
    .toBe(64);
  await expect(
    page.getByLabel("Expand sidebar", { exact: true }),
  ).toBeVisible();
  expect(
    (await page.locator(".graph-container").boundingBox())!.width,
  ).toBeGreaterThan(before!.width + 120);
  expect(await state(page)).toBe(viewport);
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Archived", exact: true }),
  ).toHaveClass(/active/);
  expect(await state(page)).toBe(viewport);
  await page.reload();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page
    .getByRole("button", { name: "Settings & backups", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace settings" }),
  ).toBeVisible();
});
test("inspector pointer resize, keyboard limits, reset and persistence never move viewport", async ({
  page,
}) => {
  await demo(page);
  const viewport = await state(page);
  const handle = page.getByRole("separator", {
    name: "Resize paper inspector",
  });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 140, box.y + 100, { steps: 12 });
  await page.mouse.up();
  const width = (await page.locator(".inspector-shell").boundingBox())!.width;
  expect(width).toBeGreaterThan(450);
  expect(await state(page)).toBe(viewport);
  await handle.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  expect(
    Math.round((await page.locator(".inspector-shell").boundingBox())!.width),
  ).toBe(280);
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  const total = (await page.locator(".workspace-body").boundingBox())!.width;
  expect(
    (await page.locator(".inspector-shell").boundingBox())!.width,
  ).toBeLessThanOrEqual(total * 0.6 + 1);
  expect(
    Math.round((await page.locator(".inspector-shell").boundingBox())!.width),
  ).toBe(Number(await handle.getAttribute("aria-valuemax")));
  expect(await state(page)).toBe(viewport);
  await handle.dblclick();
  expect(
    Math.round((await page.locator(".inspector-shell").boundingBox())!.width),
  ).toBe(344);
  await handle.press("ArrowLeft");
  const wanted = Math.round(
    (await page.locator(".inspector-shell").boundingBox())!.width,
  );
  await page.reload();
  await page.getByLabel("Search local papers").fill("Attention Is All");
  await page.locator(".search-results button").first().click();
  expect(
    Math.round((await page.locator(".inspector-shell").boundingBox())!.width),
  ).toBe(wanted);
});
test("all routine graph interactions preserve the exact viewport; explicit Focus still works", async ({
  page,
}) => {
  await demo(page);
  const pane = (await page.locator(".graph-container").boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height * 0.8);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(
    pane.x + pane.width / 2 + 55,
    pane.y + pane.height * 0.8 + 25,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.mouse.wheel(0, 150);
  await page.waitForTimeout(350);
  const viewport = await state(page);
  await page.getByLabel("Search local papers").fill("Attention Is All");
  await page.locator(".search-results button").first().click();
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Paper status").selectOption("candidate");
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Paper tags").fill("test tag");
  await page.getByLabel("Paper tags").blur();
  expect(await state(page)).toBe(viewport);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(/Attention/);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  expect(await state(page)).toBe(viewport);
  await page.getByRole("button", { name: /Connections/ }).click();
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Close inspector", { exact: true }).click();
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Focal core paper").selectOption({
    label: "BERT: Pre-training of Deep Bidirectional Transformers",
  });
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Collapse sidebar").click();
  await page.waitForTimeout(250);
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Expand sidebar").click();
  await page.waitForTimeout(250);
  expect(await state(page)).toBe(viewport);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Hide archived", { exact: true }).check();
  expect(await state(page)).toBe(viewport);
  await page.getByLabel("Hide archived", { exact: true }).uncheck();
  await action(page, "Add Paper Manually");
  await page
    .getByRole("dialog")
    .getByLabel("Paper title")
    .fill("A newly imported paper");
  await page.getByRole("button", { name: "Save paper", exact: true }).click();
  expect(await state(page)).toBe(viewport);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.waitForTimeout(450);
  expect(await state(page)).not.toBe(viewport);
});
test("source lists refresh on every open, show cached results immediately, and retain IEEE-only evidence", async ({
  page,
}) => {
  await page.goto("/");
  let requests = 0,
    fail = false;
  await page.route("https://api.openalex.org/**", async (route) => {
    requests++;
    if (fail) return route.abort();
    await new Promise((r) => setTimeout(r, 700));
    return route.fulfill({
      json: {
        meta: { count: 2 },
        results: [
          {
            id: "https://openalex.org/W2",
            title: "OpenAlex related",
            doi: "https://doi.org/10.1234/b",
            publication_year: 2024,
          },
        ],
      },
    });
  });
  await page.evaluate(async () => {
    const { backend } = await import("/src/services/backend.ts");
    const { newPaper } = await import("/src/types.ts");
    const focal = await backend.save(
      newPaper({
        title: "Focal",
        doi: "10.1234/focal",
        openalex: "https://openalex.org/W1",
        ieee: "726791",
      }),
    );
    const ieee = [
      newPaper({ title: "OpenAlex related", doi: "10.1234/b" }),
      newPaper({ title: "IEEE only", doi: "10.1234/c" }),
    ];
    localStorage.setItem(`evidence-${focal.id}`, JSON.stringify([]));
    const s = await backend.snapshot();
    localStorage.setItem(
      `evidence-${s.workspace.id}`,
      JSON.stringify([
        {
          id: crypto.randomUUID(),
          provider: "IEEE",
          direction: "references",
          focal,
          capturedAt: new Date().toISOString(),
          sourceUrl: "https://ieeexplore.ieee.org/document/726791",
          method: "Fixture capture",
          coverage: "partial",
          total: 8,
          raw: "",
          error: "",
          items: ieee,
        },
      ]),
    );
  });
  await page.reload();
  await page.getByLabel("Search local papers").fill("Focal");
  await page.locator(".search-results button").first().click();
  await page
    .getByRole("button", { name: "Find Referenced Papers", exact: true })
    .click();
  await expect(page.getByText("IEEE only", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Reported by both sources", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  fail = true;
  await page
    .getByRole("button", { name: "Find Referenced Papers", exact: true })
    .click();
  await expect(page.getByText("IEEE only", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(requests).toBe(2);
  await expect(
    page.getByText(
      "Showing the last successful cached results. IEEE evidence is preserved.",
    ),
  ).toBeVisible();
});
for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [1100, 720],
])
  test(`visual layout ${width}x${height} in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await demo(page);
    for (const theme of ["dark", "light"]) {
      if (theme === "light")
        await page.getByLabel("Switch to light", { exact: true }).click();
      await page.getByLabel("Collapse sidebar", { exact: true }).click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `test-results/v11-${width}-${theme}.png` });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const canvas = (await page.locator(".graph-container").boundingBox())!;
      expect(canvas.height).toBeGreaterThan(height - 210);
      await page.getByLabel("Expand sidebar").click();
    }
  });
