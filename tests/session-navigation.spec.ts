import { test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { DBV3_ChatSession } from "@/types/storage";
import {
  expect,
  mockGlobalApis,
  seedIndexedDB,
  seedLocalStorage,
  OPENROUTER_API_KEY,
} from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("Chat Session Navigation", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    chatPage = new ChatPage(page);
  });
  
  test.describe("when multiple sessions exist", () => {
    const sessions: DBV3_ChatSession[] = [
        {
          session_id: "session-old",
          name: null,
          messages: [{ id: "msg1", role: "user", content: "Old message", prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
          created_at_ms: 1000, updated_at_ms: 1000,
        },
        {
          session_id: "session-middle",
          name: null,
          messages: [{ id: "msg2", role: "user", content: "Middle message", prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
          created_at_ms: 2000, updated_at_ms: 2000,
        },
        {
          session_id: "session-new",
          name: null,
          messages: [{ id: "msg3", role: "user", content: "New message", prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
          created_at_ms: 3000, updated_at_ms: 3000,
        },
      ];
    
    test.beforeEach(async ({ context }) => {
        await seedLocalStorage(context, {
          state: {
            apiKey: OPENROUTER_API_KEY,
            modelName: "google/gemini-2.5-pro",
            autoScrollEnabled: false,
          },
          version: 1,
        });
        await seedIndexedDB(context, { chat_sessions: sessions });
    });

    test("navigates between sessions and disables buttons at boundaries", async ({
      page,
    }) => {
      // Purpose: This test verifies that a user can navigate between previous and next sessions
      // and that the navigation buttons are correctly disabled at the boundaries.
      await chatPage.goto("session-new");

      await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
      await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
      await chatPage.expectMessage(0, "user", /New message/);

      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-middle"));
      await expect(chatPage.navigation.nextSessionButton).toBeEnabled();
      await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
      await chatPage.expectMessage(0, "user", /Middle message/);

      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-old"));
      await expect(chatPage.navigation.nextSessionButton).toBeEnabled();
      await expect(chatPage.navigation.prevSessionButton).toBeDisabled();
      await chatPage.expectMessage(0, "user", /Old message/);

      await chatPage.navigation.goToNextSession();
      await page.waitForURL(ROUTES.chat.session("session-middle"));
      await chatPage.expectMessage(0, "user", /Middle message/);
    });

    test("shows a new, empty session when visiting /chat/new", async ({
      page,
    }) => {
      // Purpose: This test verifies that visiting /chat/new shows an empty session
      // instead of redirecting to the latest session.
      await chatPage.goto();

      await page.waitForURL(ROUTES.chat.new);
      expect(page.url()).toContain(ROUTES.chat.new);

      await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
      await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
      await expect(chatPage.chatMessages).toHaveCount(0);
    });
  });
});
