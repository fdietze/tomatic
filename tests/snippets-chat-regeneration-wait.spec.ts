import { test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
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

test.describe("Snippet Chat with Regeneration Wait", () => {
  let chatPage: ChatPage;
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    chatPage = new ChatPage(page);
    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
      },
      version: 1,
    });
  });

  test.describe("on successful regeneration", () => {
    test.beforeEach(async ({ context }) => {
        await seedIndexedDB(context, {
          snippets: [
            { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { id: "b", name: "B", content: "Content from A_v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
            { id: "z", name: "Z", content: "Independent", isGenerated: true, prompt: "Independent", model: "mock/z", createdAt_ms: 2, updatedAt_ms: 2, generationError: null, isDirty: true },
          ],
        });
    });

    test("successfully waits for a snippet to regenerate before sending a message", async ({
      page,
    }) => {
      // Purpose: This test ensures that if a user tries to send a message containing a snippet
      // that is currently being regenerated, the chat submission will wait for the regeneration to complete.
      
      // 1. Background B regeneration (manual trigger so we can see spinner)
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "Content from A_v1_regenerated" },
        manualTrigger: true,
      });
      
      // 2. Background Z regeneration (manual trigger)
      chatMocker.mock({
        request: { model: "mock/z", messages: [{ role: "user", content: "Independent" }], stream: false },
        response: { role: "assistant", content: "Independent_regenerated" },
        manualTrigger: true,
      });
      
      // 3. User-triggered B regeneration (when user sends message while B is still dirty)
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "Content from A_v1_regenerated" },
        manualTrigger: true,
      });
      
      // 4. Final chat message (auto-resolved)
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "user", content: "Hello Content from A_v1_regenerated" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Final response." },
      });

      await chatPage.goto();
      await waitForEvent(page, "app_initialized");
      await waitForEvent(page, "app:snippet:regeneration:start");
      await chatPage.navigation.goToSettings();
      const snippetB = settingsPage.getSnippetItemView("B");
      await expect(snippetB.getByTestId("regenerating-spinner")).toBeVisible();
      await settingsPage.navigation.goBackToChat();
      
      // Start the message submission - this should wait for B to complete regeneration
      const responsePromise = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello @B");
      
      // Now resolve the background regenerations that the message is waiting for
      await chatMocker.resolveNextCompletion(); // B background (which the message was waiting for)
      await chatMocker.resolveNextCompletion(); // Z background (also completes)
      
      // Final chat call is auto-resolved (stream: true)
      await responsePromise;
      await chatPage.expectMessage(0, "user", /Hello @B/);
      await chatPage.expectMessage(1, "assistant", /Final response/);
      chatMocker.verifyComplete();
    });

    test("waits for only the relevant snippet before sending", async ({
      page,
    }) => {
      // Purpose: This test ensures that the waiting logic is fine-grained and only waits for the
      // specific snippets referenced in the message.
      
      // Background mocks for dirty snippets that will regenerate on app load
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "From A_v1_regenerated" },
      });
      chatMocker.mock({
        request: { model: "mock/z", messages: [{ role: "user", content: "Independent" }], stream: false },
        response: { role: "assistant", content: "Independent_regenerated" },
      });
      
      // Final chat call
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "user", content: "Message From A_v1_regenerated" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Final Chat Response." },
      });
      await chatPage.goto();
      await waitForEvent(page, "app_initialized");
      await waitForEvent(page, "app:snippet:regeneration:start");
      const responsePromise = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Message @B");
      await responsePromise;
      await chatPage.expectMessage(0, "user", /Message @B/);
      await chatPage.expectMessage(1, "assistant", /Final Chat Response/);
      chatMocker.verifyComplete();
    });
  });

  test.describe("on failed regeneration", () => {
    test.beforeEach(async ({ context }) => {
        await seedIndexedDB(context, {
          snippets: [
            { id: "a", name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { id: "b", name: "B", content: "Content from A_v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
          ],
        });
    });

    test("aborts message sending", async ({
      page,
      expectedConsoleErrors,
    }) => {
      // Purpose: This test ensures that if a user's message depends on a snippet that fails
      // to regenerate, the message submission is aborted and a clear error is shown.
      expectedConsoleErrors.push(
        /Failed to load resource.*500/,
        /Internal Server Error/,
      );
      
      // Mock for the first regeneration (on page load)
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: {
          role: "assistant",
          content: "",
          error: { status: 500, message: "Internal Server Error" },
        },
        manualTrigger: true,
      });
      
      // Mock for the second regeneration (when sending message)
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: {
          role: "assistant",
          content: "",
          error: { status: 500, message: "Internal Server Error" },
        },
        manualTrigger: true,
      });

      await chatPage.goto();
      await waitForEvent(page, "app_initialized");
      await waitForEvent(page, "snippet_regeneration_started");
      await chatPage.sendMessage("Hello @B");
      // Manually trigger the 500 error response for the snippet regeneration
      await chatMocker.resolveNextCompletion();
      await expect(chatPage.errorMessage).toBeVisible();
      await expect(
        chatPage.page.getByTestId("error-message").locator("p"),
      ).toHaveText(/Snippet '@multiple' failed: Snippet '@B' failed: API Error: 500 Internal Server Error/);
      // Assert that the UI did not add the user's message optimistically
      await chatPage.expectMessageCount(0);
      chatMocker.verifyComplete();
    });
  });
});
