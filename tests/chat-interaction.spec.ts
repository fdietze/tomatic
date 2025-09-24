import { test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import {
  ChatCompletionMocker,
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
  seedIndexedDB,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";
import { SystemPrompt } from "@/types/storage";

test.describe("Chat Interaction", () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
      },
      version: 1,
    });
    chatPage = new ChatPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test.describe("when sending messages", () => {
    test.beforeEach(async () => {
      // No specific DB seeding needed for these tests, start fresh.
      await chatPage.goto();
    });

    test("sends a message and sees the response", async ({ page }) => {
      // Purpose: This test verifies that a user can send a message in the chat interface and
      // receive a response from the AI assistant.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        },
        response: { role: "assistant", content: "Hello!" },
      });
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hello!" },
            { role: "user", content: "Second message" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Hello again!" },
      });

      const responsePromise = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello");
      await responsePromise;

      await chatPage.expectMessage(0, "user", /Hello/);
      await chatPage.expectMessage(1, "assistant", /Hello!/);

      const responsePromise2 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Second message");
      await responsePromise2;

      await chatPage.expectMessage(2, "user", /Second message/);
      await chatPage.expectMessage(3, "assistant", /Hello again!/);
      chatMocker.verifyComplete();
    });

    test("can select a model and get a model-specific response", async ({
      page,
    }) => {
      // Purpose: This test ensures that a user can change the selected language model and that
      // subsequent messages are processed by the newly selected model.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        },
        response: { role: "assistant", content: "Hello!" },
      });
      chatMocker.mock({
        request: {
          model: "mock-model/mock-model",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hello!" },
            { role: "user", content: "Another message" },
          ],
          stream: true,
        },
        response: { role: "assistant", content: "Response from Mock Model" },
      });

      const responsePromise1 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Hello");
      await responsePromise1;
      await chatPage.expectMessage(1, "assistant", /Hello!/);

      await chatPage.modelCombobox.selectModel(
        "Mock Model",
        "mock-model/mock-model",
      );

      const responsePromise2 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Another message");
      await responsePromise2;
      await chatPage.expectMessage(3, "assistant", /Response from Mock Model/);
      await expect(
        page.locator(
          '[data-testid="chat-message-3"][data-role="assistant"] .chat-message-role',
        ),
      ).toHaveText("assistant (mock-model/mock-model)");
      chatMocker.verifyComplete();
    });

    test("can regenerate an assistant response", async ({ page }) => {
      // Purpose: This test verifies the "regenerate" functionality.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user" as const, content: "Initial message" }],
          stream: true,
        },
        response: { role: "assistant" as const, content: "Hello!" },
      });
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user" as const, content: "Initial message" }],
          stream: true,
        },
        response: {
          role: "assistant" as const,
          content: "This is a regenerated response.",
        },
      });

      const responsePromise1 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Initial message");
      await responsePromise1;

      await chatPage.expectMessage(0, "user", /Initial message/);
      await chatPage.expectMessage(1, "assistant", /Hello!/);
      await chatPage.expectMessageCount(2);

      const responsePromise2 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.regenerateMessage(1);
      await responsePromise2;

      await chatPage.expectMessage(0, "user", /Initial message/);
      await chatPage.expectMessage(
        1,
        "assistant",
        /This is a regenerated response./,
      );
      await chatPage.expectMessageCount(2);
      chatMocker.verifyComplete();
    });

    test("can edit a user message and resubmit", async ({ page }) => {
      // Purpose: This test verifies that a user can edit one of their previous messages.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: "Initial message" }],
          stream: true,
        },
        response: { role: "assistant", content: "Initial response" },
      });
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: "Edited message" }],
          stream: true,
        },
        response: { role: "assistant", content: "Response to edited message." },
      });

      const responsePromise1 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("Initial message");
      await responsePromise1;

      await chatPage.expectMessage(0, "user", /Initial message/);
      await chatPage.expectMessage(1, "assistant", /Initial response/);
      await chatPage.expectMessageCount(2);

      const responsePromise2 = page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.editMessage(0, "Edited message");
      await responsePromise2;

      await chatPage.expectMessage(0, "user", /Edited message/);
      await chatPage.expectMessage(1, "assistant", /Response to edited message./);
      await chatPage.expectMessageCount(2);
      chatMocker.verifyComplete();
    });
  });

  test.describe("when starting a chat with a system prompt", () => {
    test.beforeEach(async ({ context, page }) => {
        const MOCK_PROMPTS: SystemPrompt[] = [
            { name: "test_prompt", prompt: "You are a helpful assistant." },
        ];
        await seedIndexedDB(context, {
            system_prompts: MOCK_PROMPTS,
        });
        await seedLocalStorage(context, {
            state: {
              apiKey: OPENROUTER_API_KEY,
              selectedPromptName: "test_prompt",
            },
            version: 1,
        });
        await page.goto(ROUTES.settings);
    });

    test("shows system prompt immediately in a new chat", async () => {
      // Purpose: This test ensures that when a system prompt is selected, it appears
      // as the first message immediately upon navigating to a new chat.
      await chatPage.navigation.goToNewChat();
      await chatPage.expectMessage(0, "system", /You are a helpful assistant/);
    });
  });

  test.describe("when editing a message in an existing session", () => {
    test.beforeEach(async ({ context }) => {
        await seedIndexedDB(context, {
            chat_sessions: [
              {
                session_id: "test-session-discard",
                name: "Test Session",
                messages: [
                  { id: "1", role: "user", content: "Initial message", model_name: null, prompt_name: null, cost: null, raw_content: undefined },
                  { id: "2", role: "assistant", content: "Initial response", model_name: "google/gemini-2.5-pro", prompt_name: null, cost: null, raw_content: undefined },
                ],
                created_at_ms: Date.now(),
                updated_at_ms: Date.now(),
              },
            ],
          });
    });

    test("can edit a user message and discard changes", async ({
      page,
    }) => {
      // Purpose: This test ensures that a user can start editing a message and then cancel the edit,
      // leaving the original message and chat history unchanged.
      await chatPage.goto("test-session-discard");
      await chatPage.expectMessage(0, "user", /Initial message/);
      await chatPage.expectMessage(1, "assistant", /Initial response/);
      await chatPage.cancelEdit(0, "This text will be discarded");
      await chatPage.expectMessage(0, "user", /Initial message/);
      await expect(
        page.locator(
          '[data-testid="chat-message-0"] [data-testid="edit-textarea"]',
        ),
      ).not.toBeVisible();
      await chatPage.expectMessage(1, "assistant", /Initial response/);
      chatMocker.verifyComplete();
    });
  });
});
