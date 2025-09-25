import { testWithAutoInit as test } from "./fixtures";
import { ChatPage } from "./pom/ChatPage";
import { DBV3_ChatSession } from "@/types/storage";
import { expect } from "./test-helpers";
import { ROUTES } from "@/utils/routes";

test.describe("New Chat Page Navigation", () => {
  let chatPage: ChatPage;

  test.beforeEach(async ({ page }) => {
    chatPage = new ChatPage(page);
  });

  test.describe("when on /chat/new with existing sessions", () => {
    const sessions: DBV3_ChatSession[] = [
      {
        session_id: "session-old",
        name: null,
        messages: [{ id: "msg1", role: "user", content: "Old message", prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
        created_at_ms: 1000,
        updated_at_ms: 1000,
      },
      {
        session_id: "session-newest",
        name: null,
        messages: [{ id: "msg3", role: "user", content: "Newest message", prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
        created_at_ms: 3000,
        updated_at_ms: 3000,
      },
    ];
    
    test.use({ 
      dbSeed: { 
        chat_sessions: sessions 
      } 
    });
    
    test("allows navigation to the previous session", async ({
      page,
    }) => {
      // Purpose: This test verifies the behavior when a user starts a new chat while
      // having previous sessions. It ensures that the app loads a fresh chat view,
      // but correctly enables the 'Prev' button to allow navigation back to the
      // most recent session.
      await expect(page).toHaveURL(ROUTES.chat.new);
      await chatPage.expectMessageCount(0);
      await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
      await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
      await chatPage.navigation.goToPrevSession();
      await page.waitForURL(ROUTES.chat.session("session-newest"));
      await chatPage.expectMessage(0, "user", /Newest message/);
      await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
      await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
    });
  });
});
