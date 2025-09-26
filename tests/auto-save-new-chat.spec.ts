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
    await settingsPage.createNewPrompt("TestBot", "You are a helpful test bot.");
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
          { role: "system", content: "You are a helpful test bot." },
          { role: "user", content: "Hi there!" }
        ],
        stream: true,
      },
      response: { role: "assistant", content: "Hello! I'm your test bot." },
    });

    // 5. Send a message to trigger auto-save
    const responsePromise = page.waitForResponse("https://openrouter.ai/api/v1/chat/completions");
    await chatPage.sendMessage("Hi there!");
    await responsePromise;

    // 6. Verify the session was auto-saved and URL changed
    await expect(page).toHaveURL(/\/chat\/[a-zA-Z0-9-_]+$/);
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
    await chatPage.expectMessage(1, "user", /Hi there!/);
    await chatPage.expectMessage(2, "assistant", /Hello! I'm your test bot/);
    await chatPage.expectMessageCount(3);

    chatMocker.verifyComplete();
  });
});
