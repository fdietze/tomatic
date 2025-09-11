import { test } from './fixtures';
import type { Message, ChatSession } from '@/types/chat';
import type { SystemPrompt } from '../src/types/storage';
import type { Buffer } from 'buffer';
import { ChatPage } from './pom/ChatPage';
import { SettingsPage } from './pom/SettingsPage';
import { createStreamResponse, expect, mockGlobalApis, OPENROUTER_API_KEY, seedIndexedDB, seedLocalStorage } from './test-helpers';

test.describe('System Prompt Interaction', () => {

  test.beforeEach(async ({ context }) => {
    await mockGlobalApis(context);
  });
  test('uses the updated system prompt when regenerating a response', async ({ context, page }) => {
    // 1. Define Mock Data
    const MOCK_PROMPTS: SystemPrompt[] = [
      { name: 'Chef', prompt: 'You are a master chef.' },
      { name: 'Pirate', prompt: 'You are a fearsome pirate.' },
    ];
    const SESSION_WITH_PROMPT: ChatSession = {
      session_id: 'session-with-prompt',
      messages: [
        { id: 'msg1', role: 'system', content: 'You are a master chef.', prompt_name: 'Chef' },
        { id: 'msg2', role: 'user', content: 'Hello chef' },
        { id: 'msg3', role: 'assistant', content: 'Hello there!', model_name: 'openai/gpt-4o' },
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    // 2. Seed Data and Mock APIs
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY, systemPrompts: MOCK_PROMPTS },
        version: 0,
      },
    });
    await seedIndexedDB(context, { chat_sessions: [SESSION_WITH_PROMPT] });

    // 3. Navigate and create POMs
    await page.goto(`/chat/${SESSION_WITH_PROMPT.session_id}`);
    const chatPage = new ChatPage(page);
    const settingsPage = new SettingsPage(page);

    // 4. Verify initial state
    await chatPage.expectMessage(0, 'system', /You are a master chef/);

    // 5. Go to settings and edit the prompt
    await chatPage.navigation.goToSettings();
    await settingsPage.startEditing('Chef');
    await settingsPage.fillPromptForm('Chef', 'You are a world-renowned French chef.');
    await settingsPage.savePrompt();

    // 6. Go back to the chat
    await settingsPage.navigation.goBackToChat();
    await page.waitForURL(`**/chat/session-with-prompt`);

    // The display should still show the *old* prompt for historical accuracy
    await chatPage.expectMessage(0, 'system', /You are a master chef/);

    // 7. Intercept the next API call and regenerate
    let sentMessages: Message[] = [];
    await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      const requestBody = (await route.request().postDataJSON()) as { messages: Message[] };
      sentMessages = requestBody.messages;
      const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Bonjour!');
      await route.fulfill({ status: 200, body: responseBody });
    });

    // 8. Start waiting for the response BEFORE clicking the button
    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.regenerateMessage(2);
    await responsePromise;

    // 9. Assert that the messages sent to the API contained the UPDATED prompt
    expect(sentMessages.length).toBe(2); // Should be [system, user]
    const systemMessage = sentMessages.find((m) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect((systemMessage as Message).content).toBe('You are a world-renowned French chef.');

    // 10. Assert the UI now shows the new response
    await chatPage.expectMessage(2, 'assistant', /Bonjour!/);
  });
});
