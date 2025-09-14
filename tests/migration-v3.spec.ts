import { test } from './fixtures';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage } from './test-helpers';
import { DBV2_ChatSession, DBV2_SystemPrompt } from '@/types/storage';
import { ROUTES } from '@/utils/routes';

test.describe('Database Migrations V3', () => {
  test.beforeEach(async ({ context }) => {
    await mockGlobalApis(context);
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
  });

  test('migrates database from v2 to v3', async ({ context, page }) => {
    // Purpose: This test verifies that the application correctly migrates the IndexedDB database
    // from version 2 to version 3. It checks that the new 'snippets' object store is created
    // while preserving existing data in 'chat_sessions' and 'system_prompts'.
    // 1. Define V2 data
    const V2_SESSION: DBV2_ChatSession = {
      session_id: 'v2-session-1',
      name: 'Test Session',
      messages: [
        { id: 'msg1', role: 'user', content: 'Hello', prompt_name: null, model_name: null, cost: null, raw_content: undefined },
        { id: 'msg2', role: 'assistant', content: 'Hi from V2', prompt_name: null, model_name: null, cost: null, raw_content: undefined },
      ],
      created_at_ms: 2000,
      updated_at_ms: 2000,
    };
    const V2_PROMPT: DBV2_SystemPrompt = {
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

    const consolePromise = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[DB] Upgrading database from version 2 to 3...'),
      timeout: 5000,
    });

    await page.goto(ROUTES.chat.new);

    await consolePromise;

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
        const sessionCountReq = tx.objectStore('chat_sessions').count();
        const promptCountReq = tx.objectStore('system_prompts').count();

        const sessionCount = await new Promise<number>(resolve => { sessionCountReq.onsuccess = () => { resolve(sessionCountReq.result); } });
        const promptCount = await new Promise<number>(resolve => { promptCountReq.onsuccess = () => { resolve(promptCountReq.result); } });

        db.close();
        return { dbVersion, hasSessionsStore, hasPromptsStore, hasSnippetsStore, sessionCount, promptCount };
      }
    );

    expect(migrationResult.dbVersion).toBe(3);
    expect(migrationResult.hasSessionsStore).toBe(true);
    expect(migrationResult.hasPromptsStore).toBe(true);
    expect(migrationResult.hasSnippetsStore).toBe(true);
    expect(migrationResult.sessionCount).toBe(1);
    expect(migrationResult.promptCount).toBe(1);
  });
});
