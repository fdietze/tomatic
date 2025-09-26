import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import {
  expect,
  ChatCompletionMocker,
  waitForSnippetRegeneration,
  seedLocalStorage,
  OPENROUTER_API_KEY,
} from "./test-helpers";
import { SettingsPage } from "./pom/SettingsPage";

test.describe("Snippet Usage in System Prompts", () => {
  let chatPage: ChatPage;
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test.describe("when a snippet is resolved in a new chat", () => {
    test.use({ 
      localStorageOverrides: {
        selectedPromptName: "TestPrompt",
      },
      dbSeed: {
        system_prompts: [
          { name: "TestPrompt", prompt: "You are a @character." },
        ],
        snippets: [
          {
            id: "char-id",
            name: "character",
            content: "helpful assistant",
            isGenerated: false,
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false,
          },
        ],
      }
    });

    test("resolves snippets in a system prompt for a new chat", async ({
      page,
    }) => {
      // Purpose: This test verifies that a snippet placeholder in a system prompt is correctly resolved with the snippet's content when a new chat is started.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Response." },
      });

      // Already at /chat/new from fixture
      const responsePromise = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello");
      await responsePromise;

      await chatPage.expectMessage(
        0,
        "system",
        /^You are a @character\.\s*$/,
      );
      await chatPage.expectMessage(1, "user", /^Hello\s*$/);
      await chatPage.expectMessage(2, "assistant", /^Response\.\s*$/);
      chatMocker.verifyComplete();
    });
  });

  test.describe("when regenerating a response with an updated snippet", () => {
    test.beforeEach(async ({ context }) => {
      await seedLocalStorage(context, {
        state: {
          apiKey: OPENROUTER_API_KEY,
          modelName: "google/gemini-2.5-pro",
          autoScrollEnabled: false,
          selectedPromptName: null,
        },
        version: 1,
      });
      // Already at /chat/new from fixture
    });

    test("uses updated snippet content when regenerating a response", async ({
      page,
    }) => {
      // Purpose: This test ensures that if a snippet's content is updated via the UI, the regenerated response from the model uses the new content.
      // 1. Initial Setup via UI
      await settingsPage.navigation.goToSettings();
      await settingsPage.createNewSnippet("character", "helpful assistant");
      await settingsPage.createNewPrompt(
        "TestPrompt",
        "You are a @character.",
      );
 
      // Go back to chat and ensure the prompt button is visible before clicking
      await settingsPage.navigation.goBackToChat();
      await expect(page.getByTestId("system-prompt-button-TestPrompt")).toBeVisible();

      // 2. Mock initial and regenerated responses
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Initial Response." },
      });
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a fearsome pirate." },
            { role: "user", content: "Hello" },
          ],
          stream: true,
        },
        response: {
          role: "assistant",
          content: "Regenerated Pirate Response.",
        },
      });

      // 3. Initial chat
      // Already at /chat/new from fixture
      await page.getByTestId("system-prompt-button-TestPrompt").click();

      const responsePromise1 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello");
      await responsePromise1;
      await chatPage.expectMessage(2, "assistant", /Initial Response/);
      
      // 4. Update snippet via UI
      await settingsPage.navigation.goToSettings();
      await settingsPage.startEditingSnippet("character");
      await settingsPage.fillSnippetForm("character", "fearsome pirate");
      await settingsPage.saveSnippet();

      // 5. Regenerate and assert
      // Navigate back to chat using UI navigation
      await settingsPage.navigation.goBackToChat();

      const regenerateButton = chatPage
        .getMessageLocator(2)
        .getByTestId("regenerate-button");
      await expect(regenerateButton).toBeVisible();

      const responsePromise2 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.regenerateMessage(2);
      await responsePromise2;
      await chatPage.expectMessage(
        0,
        "system",
        /^You are a @character\.\s*$/,
      );
      await chatPage.expectMessage(1, "user", /^Hello\s*$/);
      await chatPage.expectMessage(
        2,
        "assistant",
        /Regenerated Pirate Response/,
      );
      chatMocker.verifyComplete();
    });
  });

  test.describe("when a snippet is not found", () => {
    test.use({ 
      localStorageOverrides: {
        selectedPromptName: "TestPrompt",
      },
      dbSeed: {
        system_prompts: [
          { name: "TestPrompt", prompt: "You are a @fake_character." },
        ],
        snippets: [], // Ensure no snippets exist
      }
    });

    test("shows an error if a system prompt snippet is not found", async () => {
      // Purpose: This test checks that a clear error message is displayed to the user if a snippet referenced in the system prompt does not exist.
      await chatPage.sendMessage("Hello");

      await expect(
        chatPage.page.getByTestId("error-message").locator("p"),
      ).toHaveText("Snippet '@fake_character' not found.");
      await expect(chatPage.errorMessage).toBeVisible();
      chatMocker.verifyComplete();
    });
  });

  test.describe("when dealing with transitive dependencies", () => {
    test.use({ 
      localStorageOverrides: {
        selectedPromptName: null, // Will be set in test
      },
      dbSeed: {
        system_prompts: [
          { name: "TestPrompt", prompt: "You are a @generated_snippet." },
        ],
        snippets: [
          {
            id: "base-id",
            name: "base_snippet",
            content: "v1",
            isGenerated: false,
            createdAt_ms: 0,
            updatedAt_ms: 0,
            generationError: null,
            isDirty: false,
          },
          {
            id: "gen-id",
            name: "generated_snippet",
            content: "generated from v1",
            isGenerated: true,
            prompt: "generate from @base_snippet",
            model: "mock-model/mock-model",
            createdAt_ms: 1,
            updatedAt_ms: 1,
            generationError: null,
            isDirty: false,
          },
        ],
      }
    });
    test("uses updated, transitively dependent snippet content when regenerating a response", async ({
      page,
    }) => {
      // Purpose: This test ensures that when a base snippet is updated, a generated snippet that depends on it is regenerated first,
      // and only then is a chat message using that generated snippet (via a system prompt) regenerated with the newest content.
      // It specifically tests the async waiting logic.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a generated from v1." },
            { role: "user", content: "Hello" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Initial Response." },
      });
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "generate from v2" }],
          stream: false,
        },
        response: { role: "assistant", content: "generated from v2" },
      });
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a generated from v2." },
            { role: "user", content: "Hello" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Regenerated Response." },
      });

      await page.getByTestId("system-prompt-button-TestPrompt").click();
      const responsePromise1 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello");
      await responsePromise1;
      await chatPage.expectMessage(2, "assistant", /Initial Response/);

      await settingsPage.navigation.goToSettings();
      await settingsPage.startEditingSnippet("base_snippet");
      await settingsPage.fillSnippetForm("base_snippet", "v2");
      await settingsPage.saveSnippet();

      await waitForSnippetRegeneration(page, 'generated_snippet');

      // Navigate back to chat using UI navigation
      await settingsPage.navigation.goBackToChat();

      const regenerateButton = chatPage
        .getMessageLocator(2)
        .getByTestId("regenerate-button");
      await expect(regenerateButton).toBeVisible();

      // The mock for the snippet regeneration (v1 -> v2)
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [{ role: "user", content: "generate from v2" }],
          stream: false,
        },
        response: { role: "assistant", content: "generated from v2" },
      });

      // The mock for the chat regeneration, now expecting the updated content
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a generated from v2." },
            { role: "user", content: "Hello" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Regenerated Response." },
      });

      const responsePromise2 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.regenerateMessage(2);

      await responsePromise2;
      await chatPage.expectMessage(2, "assistant", /Regenerated Response/);
      chatMocker.verifyComplete();
    });
  });
});
