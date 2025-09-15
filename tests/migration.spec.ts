import { test } from './fixtures';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, waitForEvent } from './test-helpers';
import { DBV1_ChatSession, DBV2_ChatSession, DBV2_Message } from '@/types/storage';
import { ROUTES } from '@/utils/routes';

test.describe('Database Migrations', () => {
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

  test('migrates database from v1 to v2', async ({ context, page }) => {
    // Purpose: This test verifies the IndexedDB migration from version 1 to version 2. It ensures
    // that session data from V1 is correctly transformed to the V2 schema (adding 'id' to
    // messages, adding a null 'name' to sessions) and that the new 'system_prompts' object
    // store is created. The final db version should be 3, as migrations run sequentially.
    // 1. Define V1 data
    const V1_SESSION: DBV1_ChatSession = {
      session_id: 'v1-session-1',
      // 'name' is missing in V1
      messages: [
        { role: 'user', content: 'Hello' }, // No 'id', no 'prompt_name'
        { role: 'assistant', content: 'Hi from V1' },
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    // 2. Seed the V1 database before the app loads
    await context.addInitScript((v1Session) => {
      return new Promise<void>((resolve, reject) => {
        const dbName = 'tomatic_chat_db';
        const request = window.indexedDB.open(dbName, 1);

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
          const store = tx.objectStore('chat_sessions');
          store.put(v1Session);

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error(`V1 seeding transaction error: ${tx.error?.message ?? 'Unknown'}`));
          };
        };

        request.onerror = () => {
          reject(new Error(`V1 seeding DB open error: ${request.error?.message ?? 'Unknown'}`));
        };
      });
    }, V1_SESSION);

    // 3. Navigate to a page to trigger the app's DB initialization and migration
    await page.goto(ROUTES.chat.new);

    // Wait for the custom event that signals the V2 migration is complete
    await waitForEvent(page, 'db_migration_complete');

    // 4. Verify the data has been migrated in the browser context
    const migrationResult = await page.evaluate(
      async (
        sessionId: string,
      ): Promise<{
        session: DBV2_ChatSession | null;
        hasPromptsStore: boolean;
        hasSnippetsStore: boolean;
        dbVersion: number;
      }> => {
        const dbName = 'tomatic_chat_db';
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = window.indexedDB.open(dbName); // open with no version to get latest
          request.onsuccess = (e) => {
            resolve((e.target as IDBOpenDBRequest).result);
          };
          request.onerror = (e) => {
            const err = (e.target as IDBOpenDBRequest).error;
            reject(new Error(err?.message ?? 'Unknown IndexedDB open error'));
          };
        });

        const dbVersion = db.version;
        const hasPromptsStore = db.objectStoreNames.contains('system_prompts');
        const hasSnippetsStore = db.objectStoreNames.contains('snippets');

        const tx = db.transaction('chat_sessions', 'readonly');
        const store = tx.objectStore('chat_sessions');
        const session = await new Promise<DBV2_ChatSession>((resolve, reject) => {
          const req = store.get(sessionId);
          req.onsuccess = () => {
             resolve(req.result as DBV2_ChatSession);
          };
          req.onerror = () => {
            reject(new Error(req.error?.message ?? 'Unknown get error'));
          };
        });
        db.close();
        return { session, hasPromptsStore, hasSnippetsStore, dbVersion };
      },
      V1_SESSION.session_id,
    );

    // 5. Assertions
    expect(migrationResult.dbVersion).toBe(3);
    expect(migrationResult.hasPromptsStore).toBe(true);
    expect(migrationResult.hasSnippetsStore).toBe(true);
    const migratedSession = migrationResult.session;
    expect(migratedSession).not.toBeNull();
    if (!migratedSession) return; // for type-safety

    expect(migratedSession.session_id).toBe(V1_SESSION.session_id);
    expect(migratedSession.name).toBeNull(); // name was missing, so it should be set to null
    expect(migratedSession.messages).toHaveLength(2);

    migratedSession.messages.forEach((message: DBV2_Message) => {
      expect(typeof message.id).toBe('string');
      expect(message.id).not.toBe('');
      expect(message.prompt_name).toBeNull();
    });

    // Check message content integrity
    expect(migratedSession.messages[0].content).toBe('Hello');
    expect(migratedSession.messages[1].content).toBe('Hi from V1');
  });
});