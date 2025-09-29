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

test.describe("Snippet Full-Screen Viewer", () => {
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

  test("should open and close the full-screen markdown viewer", async ({ context, page }) => {
    // Purpose: This test verifies that the full-screen markdown viewer can be opened
    // for a snippet and then closed.

    // req:view-button-e2e-test: The test must verify the view button and the fullscreen viewer
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

    // 1. Find the snippet and click the "View" button
    const snippetItem = settingsPage.getSnippetItemView("markdown_snippet");
    await snippetItem.getByTestId("snippet-view-button").click();

    // 2. Assert that the full-screen viewer is visible
    const viewer = page.getByTestId("fullscreen-markdown-viewer");
    await expect(viewer).toBeVisible();

    // 3. Assert that the markdown content is rendered correctly
    await expect(viewer.locator("h1")).toHaveText("Hello Markdown");
    await expect(viewer.locator("p")).toHaveText("This is a test snippet with markdown.");

    // 4. Click the "Close" button
    await viewer.getByTestId("fullscreen-markdown-viewer-close-button").click();

    // 5. Assert that the viewer is no longer visible
    await expect(viewer).not.toBeVisible();
  });
});