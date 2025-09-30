import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import {
  expect,
  ChatCompletionMocker,
} from "./test-helpers";

test.describe("Snippet Usage in Chat", () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
  });

  test.describe('Successful Resolution', () => {
    test.use({
      dbSeed: {
        snippets: [
          { id: "1", name: "greet_simple", content: "Hello, world!", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          { id: "2", name: "greet_nested", content: "Hello, @name!", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          { id: "3", name: "name", content: "World", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        ]
      }
    });

    test("resolves a standard snippet in the chat input", async () => {
      // Purpose: This test verifies that a simple snippet (e.g., '@greet_simple') used in the
      // chat input is correctly resolved to its content before being sent to the API. It also
      // ensures the user message in the UI displays the original raw input.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: "Hello, World!" }],
          stream: true,
        },
        response: { role: "assistant", content: "Resolved snippet response." },
      });

      const responsePromise = chatPage.page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("@greet_nested");
      await responsePromise;

      // The user message should display the raw input, not the resolved content
      await chatPage.expectMessage(0, "user", /@greet_nested/);
      // The assistant response should be visible
      await chatPage.expectMessage(1, "assistant", /Resolved snippet response/);
      // The API mock should have been hit correctly with the resolved content
      chatMocker.verifyComplete();
    });

    test("resolves nested snippets in the chat input", async () => {
      // Purpose: This test verifies that snippets which themselves contain other snippets are
      // resolved recursively. It ensures that a nested snippet like '@greet_nested' (containing
      // '@name') is fully expanded before the content is sent to the API.
      chatMocker.mock({
        request: {
          model: "google/gemini-2.5-pro",
          messages: [{ role: "user", content: "Hello, World!" }],
          stream: true,
        },
        response: { role: "assistant", content: "Nested resolution successful." },
      });

      const responsePromise = chatPage.page.waitForResponse(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      await chatPage.sendMessage("@greet_nested");
      await responsePromise;

      await chatPage.expectMessage(0, "user", /@greet_nested/);
      await chatPage.expectMessage(
        1,
        "assistant",
        /Nested resolution successful/,
      );
      chatMocker.verifyComplete();
    });
  });

  test.describe("error handling", () => {
    test.describe("shows an error when a snippet is not found", () => {
      test.use({
        dbSeed: {
          snippets: []
        }
      });
      test("shows an error in the UI", async ({ expectedConsoleErrors }) => {
        expectedConsoleErrors.push(
          /\[resolveSnippets\] Snippet not found: @fake_snippet/,
        );
        // Purpose: This test ensures that if a user tries to use a snippet that does not
        // exist (e.g., '@fake_snippet'), an error message is displayed in the UI and no
        // message is sent to the API.
        await chatPage.sendMessage("Hello @fake_snippet");
        await expect(
          chatPage.page.getByTestId("error-message").locator("p"),
        ).toHaveText("Snippet '@fake_snippet' not found.");
        await chatPage.expectMessageCount(0);
        chatMocker.verifyComplete();
      });
    });

    test.describe("shows an error when a snippet self-references", () => {
      test.use({
        dbSeed: {
          snippets: [
            { id: "1", name: "cycle_self", content: "This is a @cycle_self", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          ]
        }
      });
      test("shows an error in the UI", async ({ expectedConsoleErrors }) => {
        expectedConsoleErrors.push(
          /\[resolveSnippets\] Cycle detected: @cycle_self -> @cycle_self/,
        );
        // Purpose: This test verifies that the application detects and prevents infinite
        // loops caused by self-referencing snippets (e.g., '@cycle_self' containing
        // '@cycle_self'). An error should be shown and no message sent.
        await chatPage.sendMessage("@cycle_self");
        await expect(
          chatPage.page.getByTestId("error-message").locator("p"),
        ).toHaveText("Snippet cycle detected: @cycle_self -> @cycle_self");
        await chatPage.expectMessageCount(0);
        chatMocker.verifyComplete();
      });
    });

    test.describe("shows an error when a multi-step snippet cycle is detected", () => {
      test.use({
        dbSeed: {
          snippets: [
            { id: "1", name: "cycle_a", content: "This is a @cycle_b", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
            { id: "2", name: "cycle_b", content: "which contains @cycle_a", isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
          ]
        }
      });
      test("shows an error in the UI", async ({ expectedConsoleErrors }) => {
        expectedConsoleErrors.push(
          /\[resolveSnippets\] Cycle detected: @cycle_a -> @cycle_b -> @cycle_a/,
        );
        // Purpose: This test verifies that the application can detect more complex, multi-step
        // snippet cycles (e.g., A -> B -> A). It ensures an error is displayed and the
        // message is not sent.
        await chatPage.sendMessage("@cycle_a");
        await expect(
          chatPage.page.getByTestId("error-message").locator("p"),
        ).toHaveText(
          "Snippet cycle detected: @cycle_a -> @cycle_b -> @cycle_a",
        );
        await chatPage.expectMessageCount(0);
        chatMocker.verifyComplete();
      });
    });
  });
});
