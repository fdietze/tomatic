import { testWithAutoInit as test } from "./fixtures";
import type { SystemPrompt } from "@/types/storage";
import { DBV3_ChatSession } from "@/types/storage";
import { ChatCompletionMocker } from "./test-helpers";
import { ChatPage } from "./pom/ChatPage";
import { SettingsPage } from "./pom/SettingsPage";

test.describe("System Prompt Interaction", () => {
  let _chatPage: ChatPage;
  let _settingsPage: SettingsPage;
  let _chatCompletionMocker: ChatCompletionMocker;

  test.beforeEach(async ({ page }) => {
    _chatPage = new ChatPage(page);
    _settingsPage = new SettingsPage(page);
    _chatCompletionMocker = new ChatCompletionMocker(page);
  });

  // Define test data at the describe level for the fixture
  const MOCK_PROMPTS: SystemPrompt[] = [
    { name: "Chef", prompt: "You are a master chef." },
    { name: "Pirate", prompt: "You are a fearsome pirate." },
  ];
  const SESSION_WITH_PROMPT: DBV3_ChatSession = {
    session_id: "session-with-prompt",
    messages: [
      {
        id: "msg1",
        role: "system",
        content: "You are a master chef.",
        prompt_name: "Chef",
        model_name: null,
        cost: null,
        raw_content: "You are a master chef.",
      },
      {
        id: "msg2",
        role: "user",
        content: "Hello chef",
        prompt_name: null,
        model_name: null,
        cost: null,
        raw_content: "Hello chef",
      },
      {
        id: "msg3",
        role: "assistant",
        content: "Hello there!",
        // Note: The model here is historical. The regeneration will use the current app setting.
        model_name: "openai/gpt-4o",
        prompt_name: null,
        cost: null,
        raw_content: "Hello there!",
      },
    ],
    name: null,
    created_at_ms: 1000,
    updated_at_ms: 1000,
  };

  // Use the enhanced fixture for both database seeding AND localStorage coordination
  test.use({ 
    dbSeed: { 
      chat_sessions: [SESSION_WITH_PROMPT],
      system_prompts: MOCK_PROMPTS,
    },
    localStorageOverrides: {
      selectedPromptName: "Chef"
    }
  });

  test("uses the updated system prompt when regenerating a response", async ({
    page,
  }) => {
    // Purpose: This test verifies that when regenerating a response, the system uses the
    // most up-to-date version of the active system prompt.
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // 3. Navigate and create POMs
    const chatPage = new ChatPage(page);
    const settingsPage = new SettingsPage(page);
    
    // Navigate to the existing session using UI navigation
    await chatPage.navigation.goToPrevSession();

    // 4. Verify initial state
    await chatPage.expectMessage(0, "system", /You are a master chef/);

    // 5. Update the prompt using the UI
    await chatPage.navigation.goToSettings();
    await settingsPage.startEditing("Chef");
    await settingsPage.fillPromptForm(
      "Chef",
      "You are a world-renowned French chef.",
    );
    await settingsPage.savePrompt();
    
    // Wait a moment for the system prompt update to propagate
    await page.waitForTimeout(100);

    // 6. Navigate back to the chat
    await settingsPage.navigation.goBackToChat();

    // 7. Mock the regeneration API call with the *new* system prompt and the *correct* model.
    // Note: The regeneration sends the full conversation history, but the system prompt
    // should be updated to the new content, while the historical messages remain unchanged.
    chatMocker.mock({
      request: {
        // The model should match what's in the app's settings state.
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: "You are a world-renowned French chef.", // Updated system prompt for regeneration
          },
          { role: "user", content: "Hello chef" }
        ],
        stream: true,
      },
      response: { role: "assistant", content: "Bonjour!" },
    });

    // 8. The display should still show the *old* prompt for historical accuracy
    await chatPage.expectMessage(0, "system", /You are a master chef/);

    // 9. Start waiting for the response BEFORE clicking the button
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await chatPage.regenerateMessage(2);
    await responsePromise;

    // Add a short wait to allow the UI to process the streamed response
    await page.waitForTimeout(500);

    // 10. Assert the UI now shows the new response
    await chatPage.expectMessage(2, "assistant", /Bonjour!/);

    // 11. Verify all mocks were consumed
    chatMocker.verifyComplete();
  });
});
