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

test.describe("Chat Regeneration with Snippets", () => {
  let chatPage: ChatPage;
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    const MOCK_SNIPPET: DBV3_Snippet = {
      id: "greet-id",
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
        { id: "msg1", role: "user" as const, content: "Hello world", raw_content: "@greet world", prompt_name: null, model_name: null, cost: null },
        { id: "msg2", role: "assistant" as const, content: "Initial response", model_name: "google/gemini-2.5-pro", prompt_name: null, cost: null, raw_content: undefined },
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      snippets: [MOCK_SNIPPET],
      chat_sessions: [SESSION_WITH_SNIPPET],
    });

    chatPage = new ChatPage(page);
    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    await chatPage.goto("session-with-snippet");
  });

  test("uses updated snippet content when regenerating a response", async ({
    page,
  }) => {
    // Purpose: This test verifies that when regenerating an assistant's response, the system
    // uses the most up-to-date content of any referenced snippets.
    
    await chatPage.expectMessage(0, "user", /@greet world/);
    await chatPage.expectMessage(1, "assistant", /Initial response/);

    const _chatUrl = page.url();
    await chatPage.navigation.goToSettings();
    await settingsPage.startEditingSnippet("greet");
    await settingsPage.fillSnippetForm("greet", "UPDATED GREETING");
    await settingsPage.saveSnippet();

    // Use navigation instead of page.goto() to avoid re-seeding the database
    await settingsPage.navigation.goBackToChat();

    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "user", content: "UPDATED GREETING world" },
          { role: "assistant", content: "Initial response" }
        ],
        stream: true,
      },
      response: {
        role: "assistant",
        content: "This is a regenerated response.",
      },
    });

    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await chatPage.regenerateMessage(1);
    await responsePromise;

    await chatPage.expectMessage(0, "user", /@greet world/);
    await chatPage.expectMessage(
      1,
      "assistant",
      /This is a regenerated response./,
    );
    await chatPage.expectMessageCount(2);

    chatMocker.verifyComplete();
  });
});
