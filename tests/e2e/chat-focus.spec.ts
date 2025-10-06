import { testWithAutoInit as test } from "../fixtures";
import { ChatPage } from "../pom/ChatPage";
import { expect, waitForEvent } from "../test-helpers";
import { DBV3_ChatSession } from "@/types/storage";

test.describe("Feature: Chat Auto-Focus", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
  });

  test("Purpose: The chat input should be focused on a new chat page.", async ({
    page,
  }) => {
    // Purpose: This test ensures that when a user navigates to the `/chat/new`
    // page, the main chat input field is automatically focused after the app
    // is fully initialized.
    await waitForEvent(page, "app_initialized");
    await expect(chatPage.chatInput).toBeFocused();
  });

  test.describe("Scenario: When editing a message", () => {
    const sessions: DBV3_ChatSession[] = [
      {
        session_id: "session-with-message",
        name: null,
        messages: [
          {
            id: "msg1",
            role: "user",
            content: "Initial message",
            prompt_name: null,
            model_name: null,
            cost: null,
            raw_content: undefined,
          },
        ],
        created_at_ms: 1000,
        updated_at_ms: 1000,
      },
    ];

    test.use({
      dbSeed: {
        chat_sessions: sessions,
      },
    });

    test("Purpose: The edit textarea should be focused after clicking the edit button.", async ({
      page,
    }) => {
      // Purpose: This test verifies that after a user sends a message and clicks
      // the "edit" button, the textarea for editing that message is automatically
      // focused.

      // The fixture starts us at /chat/new. Since we have seeded a session,
      // we can navigate to it using the "previous" button.
      await chatPage.navigation.goToPrevSession();

      // Verify we are on the correct session page.
      await page.waitForURL("**/chat/session-with-message");

      await chatPage.startEditingMessage(0);

      const editTextArea = chatPage.getEditTextArea(0);
      await expect(editTextArea).toBeFocused();
    });
  });
});