import { test } from "./fixtures";
import type { SystemPrompt } from "@/types/storage";
import { DBV3_ChatSession } from "@/types/storage";
import { ChatCompletionMocker } from "./test-helpers";
import { ChatPage } from "./pom/ChatPage";
import {
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedIndexedDB,
  seedLocalStorage,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("System Prompt Interaction", () => {
  test.beforeEach(async ({ context }) => {
    await mockGlobalApis(context);
  });
  test("uses the updated system prompt when regenerating a response", async ({
    context,
    page,
  }) => {
    // Purpose: This test verifies that when regenerating an assistant's response, the system
    // uses the most up-to-date version of the active system prompt. Even though the originally
    // displayed system prompt message in the chat remains for historical accuracy, the API
    // request for regeneration must include the edited prompt content.
    // 1. Define Mock Data
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

    // 2. Seed Data and Mock APIs
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        cachedModels: [],
        input: "",
        selectedPromptName: "Chef",
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      chat_sessions: [SESSION_WITH_PROMPT],
      system_prompts: MOCK_PROMPTS,
    });
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // 3. Navigate and create POMs
    await page.goto(ROUTES.chat.session(SESSION_WITH_PROMPT.session_id));
    const chatPage = new ChatPage(page);

    // 4. Verify initial state
    await chatPage.expectMessage(0, "system", /You are a master chef/);

    // 5. Update the prompt by re-seeding the database
    const UPDATED_PROMPTS: SystemPrompt[] = [
      { name: "Chef", prompt: "You are a world-renowned French chef." },
      { name: "Pirate", prompt: "You are a fearsome pirate." },
    ];
    await seedIndexedDB(context, { system_prompts: UPDATED_PROMPTS });

    // 6. Mock the regeneration API call with the *new* system prompt.
    // This must be done BEFORE the page reload, so the new prompt data is available
    // to the saga when it constructs the API request.
    chatMocker.mock({
      request: {
        model: "openai/gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a world-renowned French chef.",
          },
          { role: "user", content: "Hello chef" },
        ],
        stream: true,
      },
      response: { role: "assistant", content: "Bonjour!" },
    });

    // 7. Reload the page to force the app to re-read prompts from the database
    await page.reload();

    // 8. The display should still show the *old* prompt for historical accuracy
    await chatPage.expectMessage(0, "system", /You are a master chef/);

    // 9. Start waiting for the response BEFORE clicking the button
    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await chatPage.regenerateMessage(2);
    await responsePromise;

    // 10. Assert the UI now shows the new response
    await chatPage.expectMessage(2, "assistant", /Bonjour!/);

    // 11. Verify all mocks were consumed
    chatMocker.verifyComplete();
  });
});
