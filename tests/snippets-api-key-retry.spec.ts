import { test } from "./fixtures";
import { SettingsPage } from "./pom/SettingsPage";
import {
  expect,
  mockGlobalApis,
  seedLocalStorage,
  seedIndexedDB,
  waitForEvent,
  ChatCompletionMocker,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("Generated Snippets (API Key Retry)", () => {
  let settingsPage: SettingsPage;
  let chatCompletionMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    // 1. Mock global APIs
    await mockGlobalApis(context);

    // 2. Set up a chat completion mock for the successful generation
    chatCompletionMocker = new ChatCompletionMocker(page);
    await chatCompletionMocker.setup();
    chatCompletionMocker.mock({
      request: {
        model: "mock-model/mock-model",
        messages: [{ role: "user", content: "Tell me a joke" }],
        stream: false,
      },
      response: {
        role: "assistant",
        content: "Why did the scarecrow win an award? Because he was outstanding in his field!",
      },
    });

    // 3. Seed localStorage with an EMPTY API key
    await seedLocalStorage(context, {
      state: { apiKey: "" },
    });

    // 4. Seed IndexedDB with no initial snippets
    await seedIndexedDB(context, { snippets: [] });

    // 5. Navigate to the settings page and wait for init
    settingsPage = new SettingsPage(page);
    await page.goto(ROUTES.settings);
    await waitForEvent(page, "app_initialized");
  });

  test("retries failed snippet generation on API key update", async () => {
    // Purpose: This test verifies that if a snippet fails to generate due to a
    // missing API key, it is automatically retried after an API key is provided.

    // 1. Create a new generated snippet
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.getNewSnippetEditContainer();
    await editContainer.getByTestId("snippet-name-input").fill("JokeSnippet");
    await editContainer.locator('label:has-text("Generated")').click();
    await settingsPage.modelCombobox.selectModel(
      "Mock Model",
      "mock-model/mock-model",
    );
    await editContainer
      .getByTestId("snippet-prompt-input")
      .fill("Tell me a joke");
    await settingsPage.getSnippetSaveButton(editContainer).click();

    // 2. Verify that the editor closes and the snippet appears in view mode with an error
    await expect(editContainer).not.toBeVisible();
    const viewItem = settingsPage.getSnippetItemView("JokeSnippet");
    await expect(viewItem).toBeVisible();
    await expect(viewItem.getByTestId("generation-error-message")).toContainText(
      "Authentication Error: OpenRouter API key is missing."
    );

    // 3. Provide a valid API key
    await settingsPage.setApiKey("DUMMY_API_KEY");

    // 4. The retry should be automatic. The error should disappear and the content should be populated.
    await expect(viewItem.getByTestId("generation-error-message")).not.toBeVisible({ timeout: 10000 });
    await expect(viewItem).toContainText(
      "Why did the scarecrow win an award? Because he was outstanding in his field!"
    );

    // 5. Verify that the mock API call was made
    chatCompletionMocker.verifyComplete();
  });
});