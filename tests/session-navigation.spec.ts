import { test, expect, mockApis, seedChatSessions } from './fixtures';
import type { ChatSession } from '@/types/chat';
import { NavigationComponent } from './pom/NavigationComponent';

test.describe('Chat Session Navigation', () => {
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

  test.beforeEach(async ({ context, page }) => {
    // Seed the IndexedDB with mock session data
    await seedChatSessions(context, sessions);

    // Mock the models API to prevent network errors
    await mockApis(context);

    // Go to the newest session to start the test
     await page.goto('/chat/session-new');
  });

  test('navigates between sessions and disables buttons at boundaries', async ({ page }) => {
    const navigation = new NavigationComponent(page);

    // 1. On the newest session
    await expect(navigation.nextSessionButton).toBeDisabled();
    await expect(navigation.prevSessionButton).toBeEnabled();
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/New message/);

    // 2. Navigate to the middle session
    await navigation.goToPrevSession();
    await page.waitForURL('**/chat/session-middle');
    await expect(navigation.nextSessionButton).toBeEnabled();
    await expect(navigation.prevSessionButton).toBeEnabled();
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/Middle message/);

    // 3. Navigate to the oldest session
    await navigation.goToPrevSession();
    await page.waitForURL('**/chat/session-old');
    await expect(navigation.nextSessionButton).toBeEnabled();
    await expect(navigation.prevSessionButton).toBeDisabled();
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/Old message/);

    // 4. Navigate back to the middle session
    await navigation.goToNextSession();
    await page.waitForURL('**/chat/session-middle');
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/Middle message/);
  });
});
