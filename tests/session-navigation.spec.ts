import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import type { ChatSession } from '../src/types/chat';
import { expect, seedIndexedDB, seedLocalStorage, OPENROUTER_API_KEY } from './test-helpers';

test.describe('Chat Session Navigation', () => {
  test('navigates between sessions and disables buttons at boundaries', async ({ context, page }) => {
    // 1. Define Mock Data
    const sessions: ChatSession[] = [
      {
        session_id: 'session-old',
        messages: [{ id: 'msg1', role: 'user', content: 'Old message' }],
        created_at_ms: 1000,
        updated_at_ms: 1000,
        prompt_name: null,
      },
      {
        session_id: 'session-middle',
        messages: [{ id: 'msg2', role: 'user', content: 'Middle message' }],
        created_at_ms: 2000,
        updated_at_ms: 2000,
        prompt_name: null,
      },
      {
        session_id: 'session-new',
        messages: [{ id: 'msg3', role: 'user', content: 'New message' }],
        created_at_ms: 3000,
        updated_at_ms: 3000,
        prompt_name: null,
      },
    ];

    // 2. Setup Test State
    await seedLocalStorage(context, { 'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 } });
    await seedIndexedDB(context, { chat_sessions: sessions });

    // 3. Navigate to the newest session
    await page.goto('/chat/session-new');
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
