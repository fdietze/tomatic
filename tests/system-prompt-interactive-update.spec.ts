import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { DBV3_ChatSession, DBV3_SystemPrompt } from "@/types/storage";
import { ROUTES } from "@/utils/routes";

// req:system-prompt-interactive-update
test.describe("System Prompt Interactive Update", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
  });

  test.describe("when a session is loaded and user changes system prompt selection", () => {
    const systemPrompts: DBV3_SystemPrompt[] = [
      {
        name: "assistant",
        prompt: "You are a helpful assistant."
      },
      {
        name: "developer",
        prompt: "You are a senior developer."
      },
    ];

    const sessionWithSystemPrompt: DBV3_ChatSession = {
      session_id: "session-with-system",
      name: null,
      messages: [
        {
          id: "system-1",
          role: "system",
          content: "You are a helpful assistant.",
          prompt_name: "assistant",
          model_name: null,
          cost: null,
          raw_content: "You are a helpful assistant."
        },
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          prompt_name: null,
          model_name: null,
          cost: null,
          raw_content: "Hello"
        }
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    const sessionWithoutSystemPrompt: DBV3_ChatSession = {
      session_id: "session-without-system",
      name: null,
      messages: [
        {
          id: "msg-2",
          role: "user",
          content: "Hello without system prompt",
          prompt_name: null,
          model_name: null,
          cost: null,
          raw_content: "Hello without system prompt"
        }
      ],
      created_at_ms: 2000,
      updated_at_ms: 2000,
    };

    test.use({
      dbSeed: {
        chat_sessions: [sessionWithSystemPrompt, sessionWithoutSystemPrompt],
        system_prompts: systemPrompts,
        snippets: []
      }
    });

    test("should update system message when changing prompt selection in session with existing system prompt", async ({ page }) => {
      // Purpose: This test verifies that when a user changes the system prompt selection
      // in a session that already has a system prompt, the system message is updated immediately
      // but changes are only persisted on submission/regeneration

      // Start from /chat/new and navigate to session with system prompt
      await page.waitForURL(ROUTES.chat.new);
      await chatPage.navigation.goToPrevSession(); // Go to session-without-system (most recent)
      await chatPage.navigation.goToPrevSession(); // Go to session-with-system
      await page.waitForURL(ROUTES.chat.session("session-with-system"));
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
      await chatPage.expectMessage(1, "user", /Hello/);
      await chatPage.expectSelectedSystemPrompt("assistant");

      // Change to developer prompt
      await chatPage.clickSystemPromptButton("developer");
      await chatPage.expectSelectedSystemPrompt("developer");

      // The system message should be updated immediately
      await chatPage.expectMessage(0, "system", /You are a senior developer/);
      await chatPage.expectMessage(1, "user", /Hello/);

      // Deselect the prompt
      await chatPage.clickSystemPromptButton("developer"); // Clicking selected prompt deselects it
      await chatPage.expectSelectedSystemPrompt(null);

      // The system message should be removed immediately
      await chatPage.expectMessage(0, "user", /Hello/);
      await chatPage.expectMessageCount(1); // Only the user message should remain

      // Select assistant prompt again
      await chatPage.clickSystemPromptButton("assistant");
      await chatPage.expectSelectedSystemPrompt("assistant");

      // The system message should be added back immediately
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
      await chatPage.expectMessage(1, "user", /Hello/);
      await chatPage.expectMessageCount(2);
    });

    test("should add system message when selecting prompt in session without system prompt", async ({ page }) => {
      // Purpose: This test verifies that when a user selects a system prompt
      // in a session that doesn't have a system prompt, the system message is added immediately

      // Start from /chat/new and navigate to session without system prompt
      await page.waitForURL(ROUTES.chat.new);
      await chatPage.navigation.goToPrevSession(); // Go to session-without-system (most recent)
      await page.waitForURL(ROUTES.chat.session("session-without-system"));
      await chatPage.expectMessage(0, "user", /Hello without system prompt/);
      await chatPage.expectSelectedSystemPrompt(null);
      await chatPage.expectMessageCount(1);

      // Select developer prompt
      await chatPage.clickSystemPromptButton("developer");
      await chatPage.expectSelectedSystemPrompt("developer");

      // The system message should be added immediately
      await chatPage.expectMessage(0, "system", /You are a senior developer/);
      await chatPage.expectMessage(1, "user", /Hello without system prompt/);
      await chatPage.expectMessageCount(2);

      // Change to assistant prompt
      await chatPage.clickSystemPromptButton("assistant");
      await chatPage.expectSelectedSystemPrompt("assistant");

      // The system message should be updated immediately
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
      await chatPage.expectMessage(1, "user", /Hello without system prompt/);
      await chatPage.expectMessageCount(2);

      // Deselect the prompt
      await chatPage.clickSystemPromptButton("assistant"); // Clicking selected prompt deselects it
      await chatPage.expectSelectedSystemPrompt(null);

      // The system message should be removed immediately
      await chatPage.expectMessage(0, "user", /Hello without system prompt/);
      await chatPage.expectMessageCount(1);
    });

    test("should not persist changes until submission/regeneration", async ({ page }) => {
      // Purpose: This test verifies that changes to system prompts are only persisted
      // when an actual submission or regeneration happens, not when just changing selection

      // Start from /chat/new and navigate to session with system prompt
      await page.waitForURL(ROUTES.chat.new);
      await chatPage.navigation.goToPrevSession(); // Go to session-without-system (most recent)
      await chatPage.navigation.goToPrevSession(); // Go to session-with-system
      await page.waitForURL(ROUTES.chat.session("session-with-system"));
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
      await chatPage.expectSelectedSystemPrompt("assistant");

      // Change to developer prompt
      await chatPage.clickSystemPromptButton("developer");
      await chatPage.expectSelectedSystemPrompt("developer");
      await chatPage.expectMessage(0, "system", /You are a senior developer/);

      // Navigate away and back to verify changes are not persisted
      await chatPage.navigation.goToNewChat();
      await page.waitForURL(ROUTES.chat.new);

      // Navigate back to the original session (need to go through session-without-system first)
      await chatPage.navigation.goToPrevSession(); // Go to session-without-system
      await chatPage.navigation.goToPrevSession(); // Go to session-with-system
      await page.waitForURL(ROUTES.chat.session("session-with-system"));

      // The session should still have the original system prompt (assistant)
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
      await chatPage.expectSelectedSystemPrompt("assistant");
    });
  });
});