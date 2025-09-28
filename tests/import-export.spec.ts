import { testWithAutoInit as test, expect } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import type { Page } from "@playwright/test";
import type { Snippet } from "@/types/storage";

test.describe("Feature: Snippet Import/Export", () => {
  let settingsPage: SettingsPage;
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    settingsPage = new SettingsPage(page);
    await settingsPage.navigation.goToSettings();
  });

  test("it should export and import snippets correctly", async () => {
    // Purpose: This test verifies the entire import/export workflow.

    // 1. Create a couple of snippets
    await settingsPage.createNewSnippet("snippet1", "content1");
    await settingsPage.createNewSnippet("snippet2", "content2");

    // 2. Export snippets
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId("export-snippets-button").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf-8');
    const exportedSnippets = JSON.parse(content);

    expect(exportedSnippets).toHaveLength(2);
    expect(exportedSnippets.find((s: Snippet) => s.name === "snippet1")).toBeDefined();
    expect(exportedSnippets.find((s: Snippet) => s.name === "snippet2")).toBeDefined();

    // 3. Delete snippets
    await settingsPage.deleteSnippet("snippet1");
    await settingsPage.deleteSnippet("snippet2");
    await expect(page.locator(".snippet-list .system-prompt-item-view")).toHaveCount(0);

    // 4. Import snippets
    await page.getByTestId("import-snippets-button").click();
    await page.getByTestId("import-snippets-input").setInputFiles({
        name: "snippets.json",
        mimeType: "application/json",
        buffer: Buffer.from(content),
    });

    // 5. Verify snippets are imported
    await expect(page.locator(".snippet-list .system-prompt-item-view")).toHaveCount(2);
    await settingsPage.expectSnippetToBeVisible("snippet1");
    await settingsPage.expectSnippetToBeVisible("snippet2");
  });
});