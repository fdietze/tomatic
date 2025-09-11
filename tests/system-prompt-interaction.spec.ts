import { test, expect, createStreamResponse, mockApis, seedChatSessions } from './fixtures';
import type { ChatSession, Message } from '@/types/chat';
import type { SystemPrompt } from '@/types/storage';
import type { Buffer } from 'buffer';

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

test.describe('System Prompt Interaction', () => {
  test.beforeEach(async ({ context, page }) => {
    // Mock APIs, seed the database, and navigate to the starting page
    await mockApis(context);

    // Seed localStorage with the OLD format for system prompts to test the migration.
    await context.addInitScript((prompts) => {
      // This guard prevents a test from re-seeding if it navigates to a new page.
      if (window._localStorageSeeded) return;
      const persistedState = {
        state: {
          systemPrompts: prompts,
          apiKey: 'TEST_API_KEY',
        },
        version: 0, // Set to 0 to trigger migration
      };
      window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));
      window._localStorageSeeded = true;
    }, MOCK_PROMPTS);

    // Seed the database with the chat session using the new helper.
    await seedChatSessions(context, [SESSION_WITH_PROMPT]);

    await page.goto(`http://localhost:5173/chat/${SESSION_WITH_PROMPT.session_id}`);
  });

  test('uses the updated system prompt when regenerating a response', async ({ page }) => {
    // 1. Verify initial state
    await expect(page.locator('[data-role="system"] .chat-message-content')).toHaveText(
      /You are a master chef/
    );

    // 2. Go to settings and edit the prompt
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForURL('**/settings');
    const chefPrompt = page.getByTestId('system-prompt-item-Chef');
    await chefPrompt.getByTestId('system-prompt-edit-button').click();
    await page
      .getByTestId('system-prompt-prompt-input')
      .fill('You are a world-renowned French chef.');
    await page.getByTestId('system-prompt-save-button').click();

    // 3. Go back to the chat
    await page.getByRole('button', { name: 'Chat' }).click();
    await page.waitForURL(`**/chat/${SESSION_WITH_PROMPT.session_id}`);

    // The display should still show the *old* prompt for historical accuracy
    await expect(page.locator('[data-role="system"] .chat-message-content')).toHaveText(
      /You are a master chef/
    );

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
    await page.locator('[data-testid="chat-message-2"] button:has-text("regenerate")').click();
    await responsePromise;

    // 6. Assert that the messages sent to the API contained the UPDATED prompt
    expect(sentMessages.length).toBe(2); // Should be [system, user]
    const systemMessage = sentMessages.find((m) => m.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toBe('You are a world-renowned French chef.');

    // 7. Assert the UI now shows the new response
    await expect(
      page.locator('[data-testid="chat-message-2"] .chat-message-content')
    ).toHaveText(/Bonjour!/);
  });
});
