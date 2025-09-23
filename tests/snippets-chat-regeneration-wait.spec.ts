import { ROUTES } from "@/utils/routes";
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
            { name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { name: "B", content: "Content from A_v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
            { name: "Z", content: "Independent", isGenerated: true, prompt: "Independent", model: "mock/z", createdAt_ms: 2, updatedAt_ms: 2, generationError: null, isDirty: true },
          ],
        });
    });

    test("successfully waits for a snippet to regenerate before sending a message", async ({
      page,
    }) => {
      // Purpose: This test ensures that if a user tries to send a message containing a snippet
      // that is currently being regenerated, the chat submission will wait for the regeneration to complete.
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "Content from A_v1_regenerated" },
        manualTrigger: true,
      });
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "Content from A_v1_regenerated" },
        manualTrigger: true,
      });
      chatMocker.mock({
        request: { model: "mock-model/mock-model", messages: [{ role: "user", content: "Prompt for B using v1" }], stream: false },
        response: { role: "assistant", content: "Content from A_v1_regenerated" },
        manualTrigger: true,
      });
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
      await waitForEvent(page, "app:snippet:regeneration:start");
      await page.goto(ROUTES.settings);
      const snippetB = settingsPage.getSnippetItem("B");
      await expect(snippetB.getByTestId("regenerating-spinner")).toBeVisible();
      await settingsPage.navigation.goBackToChat();
      const responsePromise = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello @B");
      await chatMocker.resolveNextCompletion();
      await chatMocker.resolveNextCompletion();
      await chatMocker.resolveNextCompletion();
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
      chatMocker.mock({
        request: { model: "mock/b", messages: [{ role: "user", content: "From v1" }], stream: false },
        response: { role: "assistant", content: "From A_v1_regenerated" },
      });
      chatMocker.mock({
        request: { model: "mock/z", messages: [{ role: "user", content: "Independent" }], stream: false },
        response: { role: "assistant", content: "Independent_regenerated" },
        manualTrigger: true,
      });
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
      await waitForEvent(page, "app:snippet:regeneration:start");
      const responsePromise = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Message @B");
      await responsePromise;
      await chatPage.expectMessage(0, "user", /Message @B/);
      await chatPage.expectMessage(1, "assistant", /Final Chat Response/);
      await chatMocker.resolveNextCompletion();
      chatMocker.verifyComplete();
    });
  });

  test.describe("on failed regeneration", () => {
    test.beforeEach(async ({ context }) => {
        await seedIndexedDB(context, {
          snippets: [
            { name: "A", content: "v1", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { name: "B", content: "Content from A_v1", isGenerated: true, prompt: "Prompt for B using @A", model: "mock-model/mock-model", createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: true },
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
      await waitForEvent(page, "snippet_regeneration_started");
      await chatPage.sendMessage("Hello @B");
      await chatMocker.resolveNextCompletion();
      await expect(chatPage.errorMessage).toBeVisible();
      await expect(
        chatPage.page.getByTestId("error-message").locator("p"),
      ).toHaveText(
        "Snippet '@B' failed to regenerate: 500 Internal Server Error",
      );
      await chatPage.expectMessageCount(0);
      chatMocker.verifyComplete();
    });
  });
});
