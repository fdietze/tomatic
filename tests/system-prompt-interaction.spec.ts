import { test, expect, createStreamResponse } from './fixtures';
import type { ChatSession } from '@/types/chat';
import type { SystemPrompt } from '@/types/storage';

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
  test('uses the updated system prompt when regenerating a response', async ({
    page,
    context,
  }) => {
    // 1. Seed the database and local storage
    await context.addInitScript(
      ({ session, prompts }) => {
        // This script runs on every navigation. We only want to seed data once.
        if ((window as any).hasBeenSeeded) return;
        (window as any).hasBeenSeeded = true;

        // Seed localStorage
        const persistedState = {
          state: { systemPrompts: prompts, apiKey: 'TEST_API_KEY' },
          version: 0,
        };
        window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));

        // Seed IndexedDB
        return new Promise((resolve) => {
          const request = indexedDB.open('tomatic_chat_db', 2);
          request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('chat_sessions')) {
              const store = db.createObjectStore('chat_sessions', { keyPath: 'session_id' });
              store.createIndex('updated_at_ms', 'updated_at_ms');
            }
          };
          request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const tx = db.transaction('chat_sessions', 'readwrite');
            tx.objectStore('chat_sessions').put(session);
            tx.oncomplete = () => {
              db.close();
              resolve(undefined);
            };
          };
        });
      },
      { session: SESSION_WITH_PROMPT, prompts: MOCK_PROMPTS }
    );

    // 2. Navigate to the chat page
    await page.goto(`http://localhost:5173/chat/${SESSION_WITH_PROMPT.session_id}`);
    await expect(page.locator('[data-role="system"] .chat-message-content')).toHaveText(
      /You are a master chef/
    );

    // 3. Go to settings and edit the prompt
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForURL('**/settings');
    const chefPrompt = page.getByTestId('system-prompt-item-Chef');
    await chefPrompt.getByTestId('system-prompt-edit-button').click();
    await page
      .getByTestId('system-prompt-prompt-input')
      .fill('You are a world-renowned French chef.');
    await page.getByTestId('system-prompt-save-button').click();

    // 4. Go back to the chat
    await page.getByRole('button', { name: 'Chat' }).click();
    await page.waitForURL(`**/chat/${SESSION_WITH_PROMPT.session_id}`);

    // The display should still show the *old* prompt for historical accuracy
    await expect(page.locator('[data-role="system"] .chat-message-content')).toHaveText(
      /You are a master chef/
    );

    // 5. Intercept the next API call and regenerate
    let sentMessages: any[] = [];
    await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      const requestBody = await route.request().postDataJSON();
      sentMessages = requestBody.messages;
      const responseBody = createStreamResponse('openai/gpt-4o', 'Bonjour!');
      await route.fulfill({ status: 200, body: responseBody });
    });

    // Start waiting for the response BEFORE clicking the button
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
