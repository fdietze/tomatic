import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import {
  ChatCompletionMocker,
  expect,
} from "./test-helpers";

test.describe("Copy Button", () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test("is visible on a finished message", async ({ page }) => {
    // Purpose: This test verifies that the copy button is visible on a code block
    // after the message has been fully streamed.
    chatMocker.mock({
      request: {
        model: "google/gemini-2.5-pro",
        messages: [{ role: "user", content: "give me code" }],
        stream: true,
      },
      response: { role: "assistant", content: "```\\nconst x = 1;\\n```" },
    });

    const responsePromise = page.waitForResponse(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    await chatPage.sendMessage("give me code");
    await responsePromise;

    await chatPage.expectMessage(1, "assistant", /const x = 1;/);

    const copyButton = page.locator('[data-testid="chat-message-1"] .copy-button');
    await expect(copyButton).toBeVisible();
    chatMocker.verifyComplete();
  });
});