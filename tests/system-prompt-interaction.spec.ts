import { test, expect, createStreamResponse } from './fixtures';
import type { Message } from '@/types/chat';
import type { Buffer } from 'buffer';
import { ChatPage } from './pom/ChatPage';
import { SettingsPage } from './pom/SettingsPage';

test.describe('System Prompt Interaction', () => {
  test('uses the updated system prompt when regenerating a response', async ({ chatPageWithPrompt, page }) => {
    const chatPage: ChatPage = chatPageWithPrompt;
    const settingsPage = new SettingsPage(page); // For navigation to settings

    // 1. Verify initial state
    await chatPage.expectMessage(0, 'system', /You are a master chef/);

    // 2. Go to settings and edit the prompt
    await chatPage.navigation.goToSettings();
    await settingsPage.startEditing('Chef');
    await settingsPage.fillPromptForm('Chef', 'You are a world-renowned French chef.');
    await settingsPage.savePrompt();

    // 3. Go back to the chat
    await settingsPage.navigation.goBackToChat();
    await page.waitForURL(`**/chat/session-with-prompt`);

    // The display should still show the *old* prompt for historical accuracy
    await chatPage.expectMessage(0, 'system', /You are a master chef/);

    // 4. Intercept the next API call and regenerate
    let sentMessages: Message[] = [];
    await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      const requestBody = (await route.request().postDataJSON()) as { messages: Message[] };
      sentMessages = requestBody.messages;
      const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Bonjour!');
      await route.fulfill({ status: 200, body: responseBody });
    });

    // 5. Start waiting for the response BEFORE clicking the button
    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.regenerateMessage(2);
    await responsePromise;

    // 6. Assert that the messages sent to the API contained the UPDATED prompt
    expect(sentMessages.length).toBe(2); // Should be [system, user]
    const systemMessage = sentMessages.find((m) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toBe('You are a world-renowned French chef.');

    // 7. Assert the UI now shows the new response
    await chatPage.expectMessage(2, 'assistant', /Bonjour!/)
  });
});
