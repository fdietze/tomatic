import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { DBV3_ChatSession, DBV3_SystemPrompt } from "@/types/storage";
import { ROUTES } from "@/utils/routes";

// req:system-prompt-navigation-sync
test.describe("System Prompt Navigation Sync", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
  });

  test.describe("when navigating between sessions with different system prompts", () => {
    const systemPrompts: DBV3_SystemPrompt[] = [
      {
        name: "assistant", 
        prompt: "You are a helpful assistant."
      },
      {
        name: "developer",
        prompt: "You are a senior developer."
      },
      {
        name: "reviewer",
        prompt: "You are a code reviewer."
      },
    ];

    const sessions: DBV3_ChatSession[] = [
      {
        session_id: "session-1",
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
            content: "Hello assistant", 
            prompt_name: null, 
            model_name: null, 
            cost: null, 
            raw_content: "Hello assistant" 
          }
        ],
        created_at_ms: 1000, 
        updated_at_ms: 1000,
      },
      {
        session_id: "session-2",
        name: null,
        messages: [
          { 
            id: "system-2", 
            role: "system", 
            content: "You are a senior developer.", 
            prompt_name: "developer", 
            model_name: null, 
            cost: null, 
            raw_content: "You are a senior developer." 
          },
          { 
            id: "msg-2", 
            role: "user", 
            content: "Help me with code", 
            prompt_name: null, 
            model_name: null, 
            cost: null, 
            raw_content: "Help me with code" 
          }
        ],
        created_at_ms: 2000, 
        updated_at_ms: 2000,
      },
      {
        session_id: "session-3",
        name: null,
        messages: [
          { 
            id: "system-3", 
            role: "system", 
            content: "You are a code reviewer.", 
            prompt_name: "reviewer", 
            model_name: null, 
            cost: null, 
            raw_content: "You are a code reviewer." 
          },
          { 
            id: "msg-3", 
            role: "user", 
            content: "Review this code", 
            prompt_name: null, 
            model_name: null, 
            cost: null, 
            raw_content: "Review this code" 
          }
        ],
        created_at_ms: 3000, 
        updated_at_ms: 3000,
      },
      {
        session_id: "session-no-system",
        name: null,
        messages: [
          { 
            id: "msg-no-system", 
            role: "user", 
            content: "Hello without system prompt", 
            prompt_name: null, 
            model_name: null, 
            cost: null, 
            raw_content: "Hello without system prompt" 
          }
        ],
        created_at_ms: 4000, 
        updated_at_ms: 4000,
      },
    ];

    test.use({ 
      dbSeed: { 
        chat_sessions: sessions,
        system_prompts: systemPrompts,
        snippets: []
      } 
    });

    test("should update selected system prompt when navigating to session with system message", async ({ page }) => {
      // Purpose: This test verifies that when navigating between chat sessions,
      // the selected system prompt automatically updates to match the prompt_name 
      // from the system message in the loaded chat history
      
      // Start from /chat/new - the test framework navigates here automatically
      await page.waitForURL(ROUTES.chat.new);
      
      // Navigate to the most recent session (session-no-system with no system prompt)
      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-no-system"));
      await chatPage.expectMessage(0, "user", /Hello without system prompt/);

      // The selected system prompt should be deselected (null)
      await chatPage.expectSelectedSystemPrompt(null);

      // Navigate to previous session (session-3 with reviewer prompt)
      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-3"));
      await chatPage.expectMessage(0, "system", /You are a code reviewer/);
      await chatPage.expectMessage(1, "user", /Review this code/);

      // The selected system prompt should now be "reviewer"
      await chatPage.expectSelectedSystemPrompt("reviewer");

      // Navigate to previous session (session-2 with developer prompt)
      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-2"));
      await chatPage.expectMessage(0, "system", /You are a senior developer/);
      await chatPage.expectMessage(1, "user", /Help me with code/);

      // The selected system prompt should now be "developer"
      await chatPage.expectSelectedSystemPrompt("developer");

      // Navigate to previous session (session-1 with assistant prompt)
      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-1"));
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
      await chatPage.expectMessage(1, "user", /Hello assistant/);

      // The selected system prompt should now be "assistant"
      await chatPage.expectSelectedSystemPrompt("assistant");

      // Navigate back forward to verify it updates correctly
      await chatPage.navigation.goToNextSession();
      await page.waitForURL(ROUTES.chat.session("session-2"));
      await chatPage.expectMessage(0, "system", /You are a senior developer/);

      // The selected system prompt should be "developer" again
      await chatPage.expectSelectedSystemPrompt("developer");
    });

    test("should deselect prompt when navigating to session without system message", async ({ page }) => {
      // Purpose: This test verifies that when navigating to a session that has no system message,
      // the system prompt should be deselected to reflect what is persisted with the session
      
      // Start from /chat/new 
      await page.waitForURL(ROUTES.chat.new);
      
      // Navigate to session-2 (developer prompt) first to set a selected prompt
      await chatPage.navigation.goToPrevSession(); // Go to session-no-system (most recent)
      await page.waitForURL(ROUTES.chat.session("session-no-system"));
      
      // Verify we're on the session without system message
      await chatPage.expectMessage(0, "user", /Hello without system prompt/);
      
      // The selected prompt should be deselected (null) because this session has no system message
      await chatPage.expectSelectedSystemPrompt(null);
      
      // Navigate to a session with a system prompt
      await chatPage.navigation.goToPrevSession(); // Go to session-3
      await page.waitForURL(ROUTES.chat.session("session-3"));
      await chatPage.expectSelectedSystemPrompt("reviewer");
      
      // Navigate back to the session without system message
      await chatPage.navigation.goToNextSession(); // Go back to session-no-system
      await page.waitForURL(ROUTES.chat.session("session-no-system"));
      
      // The prompt should be deselected again
      await chatPage.expectSelectedSystemPrompt(null);
    });
  });
});