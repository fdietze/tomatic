import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { SettingsPage } from "./pom/SettingsPage";
import { expect } from "./test-helpers";
import { ChatCompletionMocker } from "./test-helpers";

test.describe("Auto-Save New Chat Sessions", () => {
  let chatPage: ChatPage;
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test("automatically persists new chat session after first message", async ({ page }) => {
    // Purpose: This test verifies that when a user sends their first message on /chat/new,
    // the session is automatically saved to the database and the URL changes to reflect
    // the persistent session ID, allowing the conversation to survive navigation.

    // 1. Start on /chat/new (this is done automatically by testWithAutoInit)
    await expect(page).toHaveURL(/\/chat\/new$/);
    
    // 2. Verify we start on /chat/new
    await expect(page).toHaveURL(/\/chat\/new$/);

    // 3. Mock the chat API response
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "user", content: "Hello, this is my first message" }
        ],
        stream: true,
      },
      response: { role: "assistant", content: "Hello! Nice to meet you." },
    });

    // 4. Send the first message
    const responsePromise = page.waitForResponse("https://openrouter.ai/api/v1/chat/completions");
    await chatPage.sendMessage("Hello, this is my first message");
    await responsePromise;

    // 5. Verify the conversation appears correctly
    await chatPage.expectMessage(0, "user", /Hello, this is my first message/);
    await chatPage.expectMessage(1, "assistant", /Hello! Nice to meet you/);

    // 6. Wait a moment for async session creation, response completion, and navigation to complete
    await page.waitForTimeout(300);

    // 7. CRITICAL: Verify that the URL has changed to reflect the persistent session
    // The URL should have changed from /chat/new to /chat/{sessionId}
    await expect(page).toHaveURL(/\/chat\/[a-zA-Z0-9-_]+$/);
    
    // Extract the session ID from the URL for further testing
    const currentUrl = page.url();
    const sessionIdMatch = currentUrl.match(/\/chat\/([a-zA-Z0-9-_]+)$/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionIdAfterMessage = sessionIdMatch![1];
    console.log(`[DEBUG] Test: sessionIdAfterMessage extracted from URL = ${sessionIdAfterMessage}`);
    expect(sessionIdAfterMessage).toMatch(/^[a-zA-Z0-9-_]+$/); // Should be a valid session ID

    // 8. Navigate away to settings and back to test persistence
    await chatPage.navigation.goToSettings();
    await expect(page).toHaveURL(/\/settings$/);

    // 9. Navigate back to chat - should go to the persistent session, not /chat/new
    await settingsPage.navigation.goBackToChat();
    await expect(page).toHaveURL(new RegExp(`/chat/${sessionIdAfterMessage}$`));

    // 10. Verify the conversation is still there
    await chatPage.expectMessage(0, "user", /Hello, this is my first message/);
    await chatPage.expectMessage(1, "assistant", /Hello! Nice to meet you/);
    await chatPage.expectMessageCount(2);

    // 11. Verify we can still interact with the persisted session (e.g., regenerate)
    const regenerateButton = chatPage.getMessageLocator(1).getByTestId("regenerate-button");
    await expect(regenerateButton).toBeVisible();

    chatMocker.verifyComplete();
  });

  test("preserves system prompt selection when auto-saving new chat", async ({ page }) => {
    // Purpose: This test verifies that when a new chat is auto-saved, any selected
    // system prompt is preserved in the persistent session.

    // 1. Create a system prompt first
    await chatPage.navigation.goToSettings();
    await settingsPage.createNewPrompt("TestBot", "You are a helpful test bot");
    await settingsPage.navigation.goBackToChat();

    // 2. Select the system prompt on the new chat page
    console.log(`[DEBUG] URL after returning from settings: ${page.url()}`);
    await expect(page).toHaveURL(/\/chat\/new$/);
    await page.getByTestId("system-prompt-button-TestBot").click();

    // 3. Verify system message was added
    await chatPage.expectMessage(0, "system", /You are a helpful test bot/);

    // 4. Mock the chat API response
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "You are a helpful test bot" },
          { role: "user", content: "Hi there" }
        ],
        stream: true,
      },
      response: { role: "assistant", content: "Hello from your test bot" },
    });

    // 5. Send a message to trigger auto-save
    const responsePromise = page.waitForResponse("https://openrouter.ai/api/v1/chat/completions");
    await chatPage.sendMessage("Hi there");
    await responsePromise;

    // 6. Verify the session was auto-saved and URL changed
    // Wait for the URL to change from /chat/new to /chat/sessionId after the API response
    await expect(page).toHaveURL(/\/chat\/[a-zA-Z0-9-_]+$/);
    await expect(page).not.toHaveURL(/\/chat\/new$/); // Ensure it's not still "new"
    const currentUrl = page.url();
    const sessionIdMatch = currentUrl.match(/\/chat\/([a-zA-Z0-9-_]+)$/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionId = sessionIdMatch![1];

    // 7. Navigate away and back - should return to the persistent session
    await chatPage.navigation.goToSettings();
    await settingsPage.navigation.goBackToChat();
    await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`)); // Should return to the same session

    // 8. Verify the system prompt is still active and messages are preserved
    await chatPage.expectMessage(0, "system", /You are a helpful test bot/);
    await chatPage.expectMessage(1, "user", /Hi there/);
    await chatPage.expectMessage(2, "assistant", /Hello from your test bot/);
    await chatPage.expectMessageCount(3);

    chatMocker.verifyComplete();
  });

  test("preserves system prompt when starting a new chat from an existing one", async ({ page }) => {
    // Purpose: This test verifies that if a user is in a session with a system prompt,
    // clicking "New Chat" preserves the selected prompt and its message content.

    // 1. Setup: Create a prompt and start a session with it.
    await chatPage.navigation.goToSettings();
    await settingsPage.createNewPrompt("MyTestPrompt", "You are a test assistant.");
    await settingsPage.navigation.goBackToChat();
    await page.getByTestId("system-prompt-button-MyTestPrompt").click();

    // 2. Send a message to make the session persistent
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "You are a test assistant." },
          { role: "user", content: "First message to save session" },
        ],
        stream: true,
      },
      response: { role: "assistant", content: "Session saved." },
    });
    await chatPage.sendMessage("First message to save session");
    await chatPage.expectMessage(2, "assistant", /Session saved./);
    await expect(page).not.toHaveURL(/\/chat\/new$/); // Verify session is saved

    // 3. Act: Click the "New Chat" button
    await page.getByTestId("new-chat-button").click();

    // After navigation, we need to re-expose the store getter
    await chatPage.exposeTomaticTestGetStore();

    // 4. Assert: We are on a new chat page, but the prompt is preserved
    await expect(page).toHaveURL(/\/chat\/new$/);

    // The prompt button should still be selected
    const promptButton = page.getByTestId("system-prompt-button-MyTestPrompt");
    await expect(promptButton).toHaveAttribute("data-selected", "true");

    // The system message should be present in the new empty chat
    await chatPage.expectMessageCount(1);
    await chatPage.expectMessage(0, "system", /You are a test assistant./);
  });
});
