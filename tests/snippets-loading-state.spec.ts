import { ROUTES } from "@/utils/routes";
import { test } from "./fixtures";
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

test.describe("Snippet Loading State", () => {
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
    // Note: ChatCompletionMocker is now instantiated within each test for isolation
  });

  test.describe("while regenerating", () => {
    test("shows loading indicator next to buttons", async ({ context, page }) => {
      // Purpose: This test verifies that when a snippet is regenerating, the loading
      // indicator is displayed next to the action buttons, and the buttons remain visible.
      const chatMocker = new ChatCompletionMocker(page);
      await chatMocker.setup();

      await seedIndexedDB(context, {
        snippets: [
          { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          { id: "b", name: "B", content: "Content of B from v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
        ],
      });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");

      await settingsPage.expectGeneratedSnippetContent("B", /Content of B from v1/);

      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v2" }], stream: false },
        response: { role: "assistant", content: "Content of B from v2" },
        manualTrigger: true,
      });

      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2");
      await settingsPage.saveSnippet();

      const snippetB = settingsPage.getSnippetItemView("B");
      const actions = snippetB.locator('.system-prompt-actions');
      const spinner = actions.getByTestId("regenerating-spinner");
      const editButton = actions.getByTestId("snippet-edit-button");
      const deleteButton = actions.getByTestId("snippet-delete-button");

      // Assert that the spinner and buttons are all visible
      await expect(spinner).toBeVisible();
      await expect(editButton).toBeVisible();
      await expect(deleteButton).toBeVisible();

      // Resolve the regeneration and assert the spinner is gone
      await chatMocker.resolveNextCompletion();
      await expect(spinner).not.toBeVisible();
      await settingsPage.expectGeneratedSnippetContent("B", /Content of B from v2/);

      chatMocker.verifyComplete();
    });
  });

  test.describe("when a snippet is dirty", () => {
    test("shows a loading indicator on page load", async ({ context, page }) => {
      // Purpose: This test verifies that a snippet marked as 'isDirty' in the database
      // automatically shows a loading indicator when the settings page is loaded, and that
      // the indicator disappears after the automatic regeneration is complete.
      const chatMocker = new ChatCompletionMocker(page);
      await chatMocker.setup();

      await seedIndexedDB(context, {
        snippets: [
          { id: "b", name: "B", content: "Content of B from v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
          { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        ],
      });
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "Content of B from v2" },
        manualTrigger: true,
      });

      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");

      const snippetB = settingsPage.getSnippetItemView("B");
      const spinner = snippetB.getByTestId("regenerating-spinner");

      await expect(spinner).toBeVisible();

      await chatMocker.resolveNextCompletion();

      // The spinner should eventually disappear when the regeneration completes
      await expect(spinner).not.toBeVisible();

      await settingsPage.expectGeneratedSnippetContent("B", /Content of B from v2/);
      chatMocker.verifyComplete();
    });
  });

  test.describe("when editing a regenerating snippet", () => {
    test("cancels the regeneration", async ({ context, page }) => {
      // Purpose: This test verifies that if a user starts editing a snippet that is
      // currently regenerating, the regeneration process is cancelled.
      const chatMocker = new ChatCompletionMocker(page);
      await chatMocker.setup();

      await seedIndexedDB(context, {
        snippets: [
          { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          { id: "b", name: "B", content: "Content of B from v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
        ],
      });
      await page.goto(ROUTES.settings);
      await waitForEvent(page, "app:models_loaded");

      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v2" }], stream: false },
        response: { role: "assistant", content: "Content of B from v2" },
        manualTrigger: true, // Keep the regeneration pending
      });

      // Trigger regeneration
      await settingsPage.startEditingSnippet("A");
      await settingsPage.fillSnippetForm("A", "v2");
      await settingsPage.saveSnippet();

      const snippetB = settingsPage.getSnippetItemView("B");
      const spinner = snippetB.getByTestId("regenerating-spinner");
      const editButton = snippetB.getByTestId("snippet-edit-button");

      // Verify regeneration has started
      await expect(spinner).toBeVisible();

      // Click edit to cancel
      await editButton.click();

      // Verify regeneration is cancelled
      await expect(spinner).not.toBeVisible();
      await expect(settingsPage.page.getByTestId("snippet-item-edit-b")).toBeVisible();

      // Verify the mock was not consumed because the saga was cancelled
      await expect(async () => chatMocker.verifyComplete()).rejects.toThrow(
        /Test completed, but 1 mock\(s\) were not consumed/
      );
    });
  });
});