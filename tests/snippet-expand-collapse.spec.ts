import { test } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import {
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  seedIndexedDB,
  waitForEvent,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("Snippet Expand/Collapse", () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
      },
      version: 1,
    });
    settingsPage = new SettingsPage(page);
  });

  test("should expand and collapse snippet content with markdown rendering", async ({ context, page }) => {
    // Purpose: This test verifies that snippets can be expanded to show markdown-rendered content
    // and collapsed to show plain text content.

    // req:snippet-expand-collapse: The test must verify expand/collapse functionality
    await seedIndexedDB(context, {
      snippets: [
        {
          id: "snippet-1",
          name: "markdown_snippet",
          content: "# Hello Markdown\n\nThis is a test snippet with markdown.",
          isGenerated: false,
          createdAt_ms: 0,
          updatedAt_ms: 0,
          generationError: null,
          isDirty: false,
        },
      ],
    });
    await page.goto(ROUTES.settings);
    await waitForEvent(page, "app_initialized");

    // 1. Find the snippet and verify it's initially collapsed (plain text)
    const snippetItem = settingsPage.getSnippetItemView("markdown_snippet");
    const collapsedContentArea = snippetItem.locator(".system-prompt-text");
    
    // Initially should show plain text content
    await expect(collapsedContentArea).toHaveText("# Hello Markdown\n\nThis is a test snippet with markdown.");
    
    // Button should show "Expand"
    const toggleButton = snippetItem.getByTestId("snippet-toggle-button");
    await expect(toggleButton).toHaveText("Expand");

    // 2. Click the "Expand" button
    await toggleButton.click();

    // 3. Assert that the content is now rendered as markdown (Markdown component creates h1 and p elements)
    await expect(snippetItem.locator("h1")).toHaveText("Hello Markdown");
    await expect(snippetItem.locator("p")).toHaveText("This is a test snippet with markdown.");
    
    // The plain text area should no longer be visible when expanded
    await expect(collapsedContentArea).not.toBeVisible();
    
    // Button should now show "Collapse"
    await expect(toggleButton).toHaveText("Collapse");

    // 4. Click the "Collapse" button
    await toggleButton.click();

    // 5. Assert that the content is back to plain text and markdown elements are gone
    await expect(collapsedContentArea).toHaveText("# Hello Markdown\n\nThis is a test snippet with markdown.");
    await expect(collapsedContentArea).toBeVisible();
    await expect(snippetItem.locator("h1")).not.toBeVisible();
    await expect(toggleButton).toHaveText("Expand");
  });
});