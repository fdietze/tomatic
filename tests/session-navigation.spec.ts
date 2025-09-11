import { test, expect } from './fixtures';
import { ChatPage } from './pom/ChatPage';

test.describe('Chat Session Navigation', () => {
  test('navigates between sessions and disables buttons at boundaries', async ({ chatPageWithHistory }) => {
    const chatPage: ChatPage = chatPageWithHistory;

    // 1. On the newest session
    await expect(chatPage.navigation.nextSessionButton).toBeDisabled();
    await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
    await chatPage.expectMessage(0, 'user', /New message/);

    // 2. Navigate to the middle session
    await chatPage.navigation.goToPrevSession();
    await chatPage.page.waitForURL('**/chat/session-middle');
    await expect(chatPage.navigation.nextSessionButton).toBeEnabled();
    await expect(chatPage.navigation.prevSessionButton).toBeEnabled();
    await chatPage.expectMessage(0, 'user', /Middle message/);

    // 3. Navigate to the oldest session
    await chatPage.navigation.goToPrevSession();
    await chatPage.page.waitForURL('**/chat/session-old');
    await expect(chatPage.navigation.nextSessionButton).toBeEnabled();
    await expect(chatPage.navigation.prevSessionButton).toBeDisabled();
    await chatPage.expectMessage(0, 'user', /Old message/);

    // 4. Navigate back to the middle session
    await chatPage.navigation.goToNextSession();
    await chatPage.page.waitForURL('**/chat/session-middle');
    await chatPage.expectMessage(0, 'user', /Middle message/);
  });
});
