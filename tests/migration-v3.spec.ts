import { test } from './fixtures';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage } from './test-helpers';

test.describe('Database Migrations V3', () => {
  test.beforeEach(async ({ context }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 1 },
    });
  });

  test('migrates database from v2 to v3', async ({ context, page }) => {
    // 1. Define V2 data
    const V2_SESSION = {
      session_id: 'v2-session-1',
      name: 'Test Session',
      messages: [
        { id: 'msg1', role: 'user', content: 'Hello' },
        { id: 'msg2', role: 'assistant', content: 'Hi from V2' },
      ],
      created_at_ms: 2000,
      updated_at_ms: 2000,
    };
    const V2_PROMPT = {
      name: 'test_prompt',
      prompt: 'This is a test prompt.',
    };

    // 2. Seed the V2 database before the app loads
    await context.addInitScript(({ session, prompt }) => {
      return new Promise<void>((resolve, reject) => {
        const dbName = 'tomatic_chat_db';
        const request = window.indexedDB.open(dbName, 2);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (event.oldVersion < 1) {
            const sessionsStore = db.createObjectStore('chat_sessions', { keyPath: 'session_id' });
            sessionsStore.createIndex('updated_at_ms', 'updated_at_ms');
          }
          if (event.oldVersion < 2) {
            db.createObjectStore('system_prompts', { keyPath: 'name' });
          }
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction(['chat_sessions', 'system_prompts'], 'readwrite');
          tx.objectStore('chat_sessions').put(session);
          tx.objectStore('system_prompts').put(prompt);

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => { reject(new Error('V2 seeding transaction error.')); };
        };

        request.onerror = () => { reject(new Error('V2 seeding DB open error.')); };
      });
    }, { session: V2_SESSION, prompt: V2_PROMPT });

    // 3. Start listening for the console event BEFORE triggering the migration
    const consolePromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[DB] Upgrading database from version 2 to 3...'),
      timeout: 5000,
    });

    // 4. Navigate to a page to trigger the app's DB initialization and migration
    await page.goto('/chat/new');

    // 5. Now, wait for the console message to appear
    await consolePromise;

    // 4. Verify the data has been migrated in the browser context
    const migrationResult = await page.evaluate(
      async (): Promise<{
        dbVersion: number;
        hasSessionsStore: boolean;
        hasPromptsStore: boolean;
        hasSnippetsStore: boolean;
        sessionCount: number;
        promptCount: number;
      }> => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = window.indexedDB.open('tomatic_chat_db');
          request.onsuccess = () => { resolve(request.result); };
          request.onerror = () => { reject(new Error('DB open error')); };
        });

        const dbVersion = db.version;
        const hasSessionsStore = db.objectStoreNames.contains('chat_sessions');
        const hasPromptsStore = db.objectStoreNames.contains('system_prompts');
        const hasSnippetsStore = db.objectStoreNames.contains('snippets');

        const tx = db.transaction(['chat_sessions', 'system_prompts'], 'readonly');
        const sessionCount = await new Promise<number>((resolve) => {
            const req = tx.objectStore('chat_sessions').count();
            req.onsuccess = () => { resolve(req.result); };
        });
        const promptCount = await new Promise<number>((resolve) => {
            const req = tx.objectStore('system_prompts').count();
            req.onsuccess = () => { resolve(req.result); };
        });

        db.close();
        return { dbVersion, hasSessionsStore, hasPromptsStore, hasSnippetsStore, sessionCount, promptCount };
      }
    );

    // 5. Assertions
    expect(migrationResult.dbVersion).toBe(3);
    expect(migrationResult.hasSessionsStore).toBe(true);
    expect(migrationResult.hasPromptsStore).toBe(true);
    expect(migrationResult.hasSnippetsStore).toBe(true);
    expect(migrationResult.sessionCount).toBe(1);
    expect(migrationResult.promptCount).toBe(1);
  });
});
