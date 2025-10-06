import { test } from "./fixtures";
import { ROUTES } from "../src/utils/routes";
import { SettingsPage } from "./pom/SettingsPage";
import {
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  ChatCompletionMocker,
  seedIndexedDB,
  waitForEvent,
} from "./test-helpers";

test.describe("Snippet Loading Indicator with Buttons", () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

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
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test.describe("when a snippet is regenerating", () => {
    test.beforeEach(async ({ context, page }) => {
      // Set up the mock BEFORE seeding and loading the page
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Generate content" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "Regenerated content",
        },
        manualTrigger: true,
      });

      await seedIndexedDB(context, {
        snippets: [
          {
            id: "test-snippet",
            name: "test_snippet",
            content: "Initial content",
            isGenerated: true,
            prompt: "Generate content",
            model: "mock-model/mock-model",
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: true,
          },
        ],
      });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");
      await waitForEvent(page, "app:snippet:regeneration:start");
    });

    test("shows spinner alongside edit and delete buttons", async () => {
      // Purpose: This test verifies that during snippet regeneration, the loading spinner
      // is displayed alongside the edit and delete buttons, rather than replacing them.

      const snippetView = settingsPage.getSnippetItemView("test_snippet");

      // Assert that all elements are visible during regeneration
      await expect(
        snippetView.getByTestId("regenerating-spinner")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-toggle-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-edit-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-delete-button")
      ).toBeVisible();

      // Complete the regeneration
      await chatMocker.resolveNextCompletion();

      // After regeneration, spinner should be gone but buttons remain
      await expect(
        snippetView.getByTestId("regenerating-spinner")
      ).not.toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-toggle-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-edit-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-delete-button")
      ).toBeVisible();

      chatMocker.verifyComplete();
    });

    test("buttons remain functional during regeneration", async ({ page }) => {
      // Purpose: This test verifies that the edit and delete buttons remain functional
      // even while a snippet is being regenerated.

      const snippetView = settingsPage.getSnippetItemView("test_snippet");

      // Verify spinner is visible (regeneration in progress)
      await expect(
        snippetView.getByTestId("regenerating-spinner")
      ).toBeVisible();

      // Test that edit button is functional
      await snippetView.getByTestId("snippet-edit-button").click();
      const editContainer = page.getByTestId("snippet-item-edit-test-snippet");
      await expect(editContainer).toBeVisible();

      // Cancel editing to return to view mode
      await editContainer.getByTestId("snippet-cancel-button").click();
      await expect(editContainer).not.toBeVisible();

      // Test that toggle button is functional
      await snippetView.getByTestId("snippet-toggle-button").click();
      await expect(snippetView.getByTestId("snippet-toggle-button")).toHaveText(
        "Collapse"
      );

      // Complete the regeneration
      await chatMocker.resolveNextCompletion();

      chatMocker.verifyComplete();
    });
  });

  test.describe("when snippet is dirty but not regenerating", () => {
    test.beforeEach(async ({ context, page }) => {
      // Set up the mock BEFORE seeding because dirty snippets auto-regenerate on load
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "Generate content" }],
          stream: false,
        },
        response: {
          role: "assistant",
          content: "Regenerated content for dirty snippet",
        },
        manualTrigger: true,
      });

      await seedIndexedDB(context, {
        snippets: [
          {
            id: "test-snippet",
            name: "test_snippet",
            content: "Static content",
            isGenerated: true,
            prompt: "Generate content",
            model: "mock-model/mock-model",
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: true, // Dirty but not actively regenerating
          },
        ],
      });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");
      await waitForEvent(page, "app:snippet:regeneration:start");
    });

    test("shows spinner alongside buttons for dirty snippet", async () => {
      // Purpose: This test verifies that when a snippet is marked as dirty,
      // it shows the loading spinner alongside the buttons during regeneration.

      const snippetView = settingsPage.getSnippetItemView("test_snippet");

      // Assert that spinner and buttons are both visible during regeneration
      await expect(
        snippetView.getByTestId("regenerating-spinner")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-toggle-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-edit-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-delete-button")
      ).toBeVisible();

      // Complete the regeneration
      await chatMocker.resolveNextCompletion();

      // After regeneration, spinner should be gone (since snippet is no longer dirty)
      await expect(
        snippetView.getByTestId("regenerating-spinner")
      ).not.toBeVisible();

      chatMocker.verifyComplete();
    });
  });

  test.describe("when snippet is not dirty and not regenerating", () => {
    test.beforeEach(async ({ context, page }) => {
      await seedIndexedDB(context, {
        snippets: [
          {
            id: "test-snippet",
            name: "test_snippet",
            content: "Static content",
            isGenerated: true,
            prompt: "Generate content",
            model: "mock-model/mock-model",
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false, // Not dirty, so no regeneration
          },
        ],
      });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");
    });

    test("shows buttons without spinner", async () => {
      // Purpose: This test verifies that when a snippet is not dirty and not regenerating,
      // the buttons are visible and no spinner is shown.

      const snippetView = settingsPage.getSnippetItemView("test_snippet");

      // Assert that buttons are visible but spinner is not
      await expect(
        snippetView.getByTestId("regenerating-spinner")
      ).not.toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-toggle-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-edit-button")
      ).toBeVisible();
      await expect(
        snippetView.getByTestId("snippet-delete-button")
      ).toBeVisible();

      chatMocker.verifyComplete();
    });
  });
});
