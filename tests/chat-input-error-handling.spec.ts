import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { expect } from "./test-helpers";

test.describe("Chat Input Error Handling", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
  });

  test("input is restored when snippet error occurs", async () => {
    // Purpose: Verify that when a snippet error occurs (e.g. non-existent snippet),
    // the input field is restored so the user doesn't lose their text.

    await chatPage.sendMessage("Hello @non_existent_snippet");

    // Check for error message
    await expect(
      chatPage.page.getByTestId("error-message").locator("p"),
    ).toHaveText("Snippet '@non_existent_snippet' not found.");

    // Check that input is preserved (Fixed behavior)
    await expect(chatPage.chatInput).toHaveValue("Hello @non_existent_snippet");
  });
});
