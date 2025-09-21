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

test.beforeEach(async ({ context }) => {
  await mockGlobalApis(context);
});
test("sends a message and sees the response", async ({ context, page }) => {
  // Purpose: This test verifies that a user can send a message in the chat interface and
  // receive a response from the AI assistant. It also checks that the conversation history
  // is correctly maintained by sending a second message.
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
  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();
  await chatPage.goto();
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

  // Send a second message
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
  context,
  page,
}) => {
  // Purpose: This test ensures that a user can change the selected language model and that
  // subsequent messages are processed by the newly selected model, returning a model-specific response.
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
  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();
  await chatPage.goto();

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

  // The first message will use the default model
  const responsePromise1 = page.waitForResponse(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  await chatPage.sendMessage("Hello");
  await responsePromise1;
  await chatPage.expectMessage(1, "assistant", /Hello!/);

  // Select the mock model
  await chatPage.modelCombobox.selectModel(
    "Mock Model",
    "mock-model/mock-model",
  );

  // Send a message with the new model
  const responsePromise2 = page.waitForResponse(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  await chatPage.sendMessage("Another message");
  await responsePromise2;

  // Check for the mock model's specific response and details
  await chatPage.expectMessage(3, "assistant", /Response from Mock Model/);
  await expect(
    page.locator(
      '[data-testid="chat-message-3"][data-role="assistant"] .chat-message-role',
    ),
  ).toHaveText("assistant (mock-model/mock-model)");

  chatMocker.verifyComplete();
});

test("can regenerate an assistant response", async ({ context, page }) => {
  // Purpose: This test verifies the "regenerate" functionality. It checks that when a user requests
  // a regeneration of an assistant's message, a new request is sent with the same user prompt,
  // and the original assistant message is replaced with the new response.
  console.log("[TEST] Starting: can regenerate an assistant response");
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
  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();
  await chatPage.goto();

  // 1. Mock the initial response
  console.log("[TEST] Mocking initial response");
  chatMocker.mock({
    request: {
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user" as const, content: "Initial message" }],
      stream: true,
    },
    response: { role: "assistant" as const, content: "Hello!" },
  });

  // 2. Mock the regenerated response for the *same* request
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
  console.log(`[TEST] Mocks pending: ${chatMocker.getPendingMocks().length}`);

  // 3. Send the first message and await the response
  console.log("[TEST] Sending initial message");
  const responsePromise1 = page.waitForResponse(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  await chatPage.sendMessage("Initial message");
  await responsePromise1;
  console.log("[TEST] Initial response received");
  console.log(`[TEST] Mocks pending: ${chatMocker.getPendingMocks().length}`);

  // Verify initial messages
  await chatPage.expectMessage(0, "user", /Initial message/);
  await chatPage.expectMessage(1, "assistant", /Hello!/);
  await chatPage.expectMessageCount(2);

  // 4. Click the regenerate button and await the new response
  console.log("[TEST] Regenerating message");
  const responsePromise2 = page.waitForResponse(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  await chatPage.regenerateMessage(1);
  await responsePromise2;
  console.log("[TEST] Regenerated response received");
  console.log(`[TEST] Mocks pending: ${chatMocker.getPendingMocks().length}`);

  // 5. Assertions
  await chatPage.expectMessage(0, "user", /Initial message/);
  await chatPage.expectMessage(
    1,
    "assistant",
    /This is a regenerated response./,
  );
  await chatPage.expectMessageCount(2);

  // 6. Verify all mocks were consumed
  console.log("[TEST] Verifying mocks are complete");
  chatMocker.verifyComplete();
  console.log("[TEST] Finished: can regenerate an assistant response");
});

test("shows system prompt immediately in a new chat", async ({
  page,
  context,
}) => {
  // Purpose: This test ensures that if a system prompt is selected, it is displayed as the
  // first message when a new chat session is initiated.
  const chatPage = new ChatPage(page);

  // 1. Setup State and Mock APIs
  await seedLocalStorage(context, {
    state: {
      apiKey: OPENROUTER_API_KEY,
      modelName: "google/gemini-2.5-pro",
      cachedModels: [],
      input: "",
      selectedPromptName: "TestPrompt",
      autoScrollEnabled: false,
    },
    version: 1,
  });
  await seedIndexedDB(context, {
    system_prompts: [{ name: "TestPrompt", prompt: "You are a test bot." }],
  });

  // 2. Navigate
  await page.goto(ROUTES.settings);
  await chatPage.navigation.goToNewChat();

  // 3. Assert
  await chatPage.expectMessage(0, "system", /You are a test bot/);
});

test("can edit a user message and resubmit", async ({ context, page }) => {
  // Purpose: This test verifies that a user can edit one of their previous messages. It checks
  // that editing truncates the chat history to that point and resubmits the conversation with
  // the modified message, yielding a new assistant response.
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
  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();
  await chatPage.goto();

  // 1. Mock the initial response
  chatMocker.mock({
    request: {
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: "Initial message" }],
      stream: true,
    },
    response: { role: "assistant", content: "Initial response" },
  });

  // 2. Mock the response for the edited message
  chatMocker.mock({
    request: {
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: "Edited message" }],
      stream: true,
    },
    response: { role: "assistant", content: "Response to edited message." },
  });

  // 3. Send an initial message and get a response
  const responsePromise1 = page.waitForResponse(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  await chatPage.sendMessage("Initial message");
  await responsePromise1;

  // Verify initial messages
  await chatPage.expectMessage(0, "user", /Initial message/);
  await chatPage.expectMessage(1, "assistant", /Initial response/);
  await chatPage.expectMessageCount(2);

  // 4. Edit the message and re-submit
  const responsePromise2 = page.waitForResponse(
    "https://openrouter.ai/api/v1/chat/completions",
  );
  await chatPage.editMessage(0, "Edited message");
  await responsePromise2;

  // 5. Assertions
  await chatPage.expectMessage(0, "user", /Edited message/);
  await chatPage.expectMessage(1, "assistant", /Response to edited message./);
  await chatPage.expectMessageCount(2);

  // 6. Verify all mocks were consumed
  chatMocker.verifyComplete();
});

test("can edit a user message and discard changes", async ({
  context,
  page,
}) => {
  // Purpose: This test ensures that a user can start editing a message but then cancel the edit.
  // It verifies that the original message remains unchanged and no new API request is sent.
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

  // Seed the database with a session so we don't have to create one via the UI
  await seedIndexedDB(context, {
    chat_sessions: [
      {
        session_id: "test-session-discard",
        name: "Test Session",
        messages: [
          {
            id: "1",
            role: "user",
            content: "Initial message",
            model_name: null,
            prompt_name: null,
            cost: null,
            raw_content: undefined,
          },
          {
            id: "2",
            role: "assistant",
            content: "Initial response",
            model_name: "google/gemini-2.5-pro",
            prompt_name: null,
            cost: null,
            raw_content: undefined,
          },
        ],
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
      },
    ],
  });

  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup(); // setup to intercept calls

  await page.goto(ROUTES.chat.session("test-session-discard"));

  // Verify initial messages are displayed correctly
  await chatPage.expectMessage(0, "user", /Initial message/);
  await chatPage.expectMessage(1, "assistant", /Initial response/);

  // 2. Click the edit button, change the text, then cancel.
  await chatPage.cancelEdit(0, "This text will be discarded");

  // 3. Assertions
  // The original message should still be there
  await chatPage.expectMessage(0, "user", /Initial message/);
  // The edit textarea should be gone
  await expect(
    page.locator(
      '[data-testid="chat-message-0"] [data-testid="edit-textarea"]',
    ),
  ).not.toBeVisible();
  // The assistant response should still be there
  await chatPage.expectMessage(1, "assistant", /Initial response/);

  // 4. Verify that NO network calls were made
  chatMocker.verifyComplete();
});
