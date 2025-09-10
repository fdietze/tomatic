import { test, expect, mockApis } from './fixtures';

test.describe('Chat Session Navigation', () => {
  const sessions = [
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
    await context.addInitScript((mockSessions) => {
      return new Promise((resolve) => {
        const request = indexedDB.open('tomatic_chat_db', 2);
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('chat_sessions')) {
            const store = db.createObjectStore('chat_sessions', { keyPath: 'session_id' });
            store.createIndex('updated_at_ms', 'updated_at_ms');
          }
          if (!db.objectStoreNames.contains('system_prompts')) {
            db.createObjectStore('system_prompts', { keyPath: 'name' });
          }
        };
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('chat_sessions', 'readwrite');
          const store = tx.objectStore('chat_sessions');
          mockSessions.forEach((session) => store.put(session));
          tx.oncomplete = () => {
            db.close();
            resolve(undefined);
          };
        };
      });
    }, sessions);

    // Mock the models API to prevent network errors
    await mockApis(page);

    // Go to the newest session to start the test
    await page.goto('http://localhost:5173/chat/session-new');
  });

  test('navigates between sessions and disables buttons at boundaries', async ({ page }) => {
    // 1. On the newest session
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Prev' })).toBeEnabled();
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/New message/);

    // 2. Navigate to the middle session
    await page.getByRole('button', { name: 'Prev' }).click();
    await page.waitForURL('**/chat/session-middle');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Prev' })).toBeEnabled();
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/Middle message/);

    // 3. Navigate to the oldest session
    await page.getByRole('button', { name: 'Prev' }).click();
    await page.waitForURL('**/chat/session-old');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Prev' })).toBeDisabled();
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/Old message/);

    // 4. Navigate back to the middle session
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForURL('**/chat/session-middle');
    await expect(page.locator('[data-testid="chat-message-0"][data-role="user"]')).toHaveText(/Middle message/);
  });
});
