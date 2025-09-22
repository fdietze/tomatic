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

test.describe("New Chat Page Navigation", () => {
  test.beforeEach(async ({ context }) => {
    await mockGlobalApis(context);
  });

  test("when on /chat/new with existing sessions", async ({
    context,
    page,
  }) => {
    // Purpose: This test verifies the behavior when a user starts a new chat while
    // having previous sessions. It ensures that the app loads a fresh chat view,
    // but correctly enables the 'Prev' button to allow navigation back to the
    // most recent session.

    // 1. Define Mock Data
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

    // 2. Setup Test State
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: "google/gemini-2.5-pro",
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, { chat_sessions: sessions });

    const chatPage = new ChatPage(page);
    await chatPage.goto("new");

    // 3. Assert correct URL and no messages
    await expect(page).toHaveURL(ROUTES.chat.new);
    await chatPage.expectMessageCount(0);

    // 4. Assert button states
    await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
    await expect(chatPage.navigation.prevSessionButton).toBeEnabled();

    // 5. Navigate to the most recent session
    await chatPage.navigation.goToPrevSession();
    await page.waitForURL(ROUTES.chat.session("session-newest"));
    await chatPage.expectMessage(0, "user", /Newest message/);

    // 6. Assert button states on the recent session
    await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
    await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
  });
});
