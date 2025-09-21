import { test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { SettingsPage } from "./pom/SettingsPage";
import { DBV3_ChatSession, DBV3_Snippet } from "@/types/storage";
import {
  ChatCompletionMocker,
  seedLocalStorage,
  seedIndexedDB,
  OPENROUTER_API_KEY,
  mockGlobalApis,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("Chat Regeneration with Snippets", () => {
  let chatPage: ChatPage;
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    // 1. Define Mock Data
    const MOCK_SNIPPET: DBV3_Snippet = {
      name: "greet",
      content: "Hello",
      isGenerated: false,
      createdAt_ms: 0,
      updatedAt_ms: 0,
      generationError: null,
      isDirty: false,
    };
    const SESSION_WITH_SNIPPET: DBV3_ChatSession = {
      session_id: "session-with-snippet",
      name: null,
      messages: [
        {
          id: "msg1",
          role: "user" as const,
          content: "Hello world",
          raw_content: "@greet world",
          prompt_name: null,
          model_name: null,
          cost: null,
        },
        {
          id: "msg2",
          role: "assistant" as const,
          content: "Initial response",
          model_name: "google/gemini-2.5-pro",
          prompt_name: null,
          cost: null,
          raw_content: undefined,
        },
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    // 2. Seed Data
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        cachedModels: [],
        input: "",
        selectedPromptName: null,
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      snippets: [MOCK_SNIPPET],
      chat_sessions: [SESSION_WITH_SNIPPET],
    });

    // 3. Setup POMs and Mocks
    chatPage = new ChatPage(page);
    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // 4. Navigate
    await page.goto(ROUTES.chat.session(SESSION_WITH_SNIPPET.session_id));
  });

  test("uses updated snippet content when regenerating a response", async ({
    page,
  }) => {
    // Purpose: This test verifies that when regenerating an assistant's response, the system
    // uses the most up-to-date content of any referenced snippets. It ensures that if a
    // snippet has been changed since the original message was sent, the regeneration
    // request is made with the new, resolved snippet content.

    // 1. Verify initial state
    await chatPage.expectMessage(0, "user", /@greet world/);
    await chatPage.expectMessage(1, "assistant", /Initial response/);

    // 2. Update the snippet's content via the UI
    const chatUrl = page.url();
    await chatPage.navigation.goToSettings();
    await settingsPage.startEditingSnippet("greet");
    await settingsPage.fillSnippetForm("greet", "UPDATED GREETING");
    await settingsPage.saveSnippet();

    // 3. Navigate back to the chat session
    await page.goto(chatUrl);

    // 4. Mock the API call for the regeneration, expecting the *new* content
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "UPDATED GREETING world" }],
        stream: true,
      },
      response: {
        role: "assistant",
        content: "This is a regenerated response.",
      },
    });

    // 5. Click the regenerate button and await the new response
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await chatPage.regenerateMessage(1);
    await responsePromise;

    // 6. Assertions
    // The user message still shows the original raw content for historical accuracy
    await chatPage.expectMessage(0, "user", /@greet world/);
    // The assistant message is updated to the new response
    await chatPage.expectMessage(
      1,
      "assistant",
      /This is a regenerated response./,
    );
    await chatPage.expectMessageCount(2);

    // 7. Verify all mocks were consumed
    chatMocker.verifyComplete();
  });
});
