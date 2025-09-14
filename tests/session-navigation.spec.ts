import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import { DBV3_ChatSession } from '@/types/storage';
import { expect, mockGlobalApis, seedIndexedDB, seedLocalStorage, OPENROUTER_API_KEY } from './test-helpers';
import { ROUTES } from '@/utils/routes';

test.describe('Chat Session Navigation', () => {

  test.beforeEach(async ({ context }) => {
    await mockGlobalApis(context);
  });
  test('navigates between sessions and disables buttons at boundaries', async ({ context, page }) => {
    // Purpose: This test verifies the chat session navigation functionality. It checks that a user
    // can move between previous and next sessions, that the correct session content is displayed,
    // and that the navigation buttons are correctly disabled when at the beginning or end of
    // the session history.
    // 1. Define Mock Data
    const sessions: DBV3_ChatSession[] = [
      {
        session_id: 'session-old',
        name: null,
        messages: [{ id: 'msg1', role: 'user', content: 'Old message', prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
        created_at_ms: 1000,
        updated_at_ms: 1000,
      },
      {
        session_id: 'session-middle',
        name: null,
        messages: [{ id: 'msg2', role: 'user', content: 'Middle message', prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
        created_at_ms: 2000,
        updated_at_ms: 2000,
      },
      {
        session_id: 'session-new',
        name: null,
        messages: [{ id: 'msg3', role: 'user', content: 'New message', prompt_name: null, model_name: null, cost: null, raw_content: undefined }],
        created_at_ms: 3000,
        updated_at_ms: 3000,
      },
    ];

    // 2. Setup Test State
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
        selectedPromptName: null,
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, { chat_sessions: sessions });

    // 3. Navigate to the newest session
    await page.goto(ROUTES.chat.session('session-new'));
    const chatPage = new ChatPage(page);
    await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
    await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
    await chatPage.expectMessage(0, 'user', /New message/);

    // 4. Navigate to the middle session
    await chatPage.navigation.goToPrevSession();
    await chatPage.page.waitForURL('**/chat/session-middle');
    await expect(chatPage.navigation.nextSessionButton).toBeEnabled();
    await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
    await chatPage.expectMessage(0, 'user', /Middle message/);

    // 5. Navigate to the oldest session
    await chatPage.navigation.goToPrevSession();
    await chatPage.page.waitForURL('**/chat/session-old');
    await expect(chatPage.navigation.nextSessionButton).toBeEnabled();
    await expect(chatPage.navigation.prevSessionButton).toBeDisabled();
    await chatPage.expectMessage(0, 'user', /Old message/);

    // 6. Navigate back to the middle session
    await chatPage.navigation.goToNextSession();
    await chatPage.page.waitForURL('**/chat/session-middle');
    await chatPage.expectMessage(0, 'user', /Middle message/);
  });
});
