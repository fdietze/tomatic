import { test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import {
  OPENROUTER_API_KEY,
  seedLocalStorage,
  ChatCompletionMocker,
  seedIndexedDB,
  expect,
  mockGlobalApis,
} from "./test-helpers";
import { DBV3_Snippet, DBV3_ChatSession } from "@/types/storage";
import { ROUTES } from "@/utils/routes";

test.describe("Chat Editing with Snippets", () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    chatPage = new ChatPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test("can edit a message to use a different snippet and preserves raw content", async ({
    context,
    page,
  }) => {
    // Purpose: This test verifies that when editing a user message containing a snippet, the
    // editor is populated with the original raw content (e.g., '@greet world') rather than the
    // resolved content. It also confirms that the message can be edited to use a different
    // snippet, and upon resubmission, the new snippet is correctly resolved for the API request.
    // 1. Define Mock Data
    const MOCK_SNIPPETS: DBV3_Snippet[] = [
      {
        name: "greet",
        content: "Hello",
        isGenerated: false,
        createdAt_ms: 0,
        updatedAt_ms: 0,
        generationError: null,
        isDirty: false,
      },
      {
        name: "farewell",
        content: "Goodbye",
        isGenerated: false,
        createdAt_ms: 0,
        updatedAt_ms: 0,
        generationError: null,
        isDirty: false,
      },
    ];

    const SESSION_WITH_SNIPPET: DBV3_ChatSession = {
      session_id: "session-edit-snippet",
      name: null,
      messages: [
        {
          id: "msg1",
          role: "user" as const,
          content: "Hello world", // Resolved content
          raw_content: "@greet world", // Original user input
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

    // 2. Seed Data and Mock APIs
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
      snippets: MOCK_SNIPPETS,
      chat_sessions: [SESSION_WITH_SNIPPET],
    });

    // 3. Navigate and create POMs
    await page.goto(ROUTES.chat.session(SESSION_WITH_SNIPPET.session_id));

    // 4. Verify initial state
    await chatPage.expectMessage(0, "user", /@greet world/);
    await chatPage.expectMessage(1, "assistant", /Initial response/);
    await chatPage.expectMessageCount(2);

    // 5. Start editing the message
    await chatPage.startEditingMessage(0);

    // 6. Assert the textarea contains the original raw content
    await expect(chatPage.getEditTextArea(0)).toHaveValue("@greet world");

    // 7. Edit the content to use a different snippet
    await chatPage.getEditTextArea(0).fill("@farewell world");

    // 8. Mock the API call for the resubmission
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "Goodbye world" }], // Should be resolved
        stream: true,
      },
      response: { role: "assistant", content: "Response to edited message." },
    });

    // 9. Resubmit the edit
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await chatPage.resubmitEdit(0);
    await responsePromise;

    // 10. Assert the final state
    await chatPage.expectMessageCount(2); // History is truncated before new response
    await chatPage.expectMessage(0, "user", /@farewell world/); // Displays new raw_content
    await chatPage.expectMessage(1, "assistant", /Response to edited message/);

    // 11. Verify mocks
    chatMocker.verifyComplete();
  });
});
