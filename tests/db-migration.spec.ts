import { test, expect } from '@playwright/test';
import type { SystemPrompt } from '@/types/storage';

const DB_NAME = 'tomatic_chat_db';
const V2_DB_VERSION = 2;
const V3_DB_VERSION = 3;

const V2_SYSTEM_PROMPTS_STORE_NAME = 'system_prompts';
const V2_CHAT_SESSIONS_STORE_NAME = 'chat_sessions';
const V3_SNIPPETS_STORE_NAME = 'snippets';

const MOCK_SYSTEM_PROMPT: SystemPrompt = {
  name: 'Test Prompt',
  prompt: 'This is a test prompt.',
};

const MOCK_CHAT_SESSION = {
    session_id: 'test_session_id',
    messages: [],
    name: 'Test Session',
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
};

test.describe('Database Migration from v2 to v3', () => {
  test('should correctly upgrade the database, create the snippets store, and preserve existing data', async ({ page }) => {
    // 1. Create a v2 database *before* the page loads
    await page.addInitScript(
      ({ dbName, dbVersion, promptsStore, sessionsStore, mockPrompt, mockSession }) => {
        return new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);

          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(promptsStore)) {
              db.createObjectStore(promptsStore, { keyPath: 'name' });
            }
            if (!db.objectStoreNames.contains(sessionsStore)) {
              const store = db.createObjectStore(sessionsStore, { keyPath: 'session_id' });
              store.createIndex('updated_at_ms', 'updated_at_ms');
            }
          };

          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction([promptsStore, sessionsStore], 'readwrite');
            tx.objectStore(promptsStore).put(mockPrompt);
            tx.objectStore(sessionsStore).put(mockSession);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };

          request.onerror = () => reject(request.error);
        });
      },
      {
        dbName: DB_NAME,
        dbVersion: V2_DB_VERSION,
        promptsStore: V2_SYSTEM_PROMPTS_STORE_NAME,
        sessionsStore: V2_CHAT_SESSIONS_STORE_NAME,
        mockPrompt: MOCK_SYSTEM_PROMPT,
        mockSession: MOCK_CHAT_SESSION,
      }
    );

    // 2. Load the application, which will trigger the upgrade
    await page.goto('/');

    // 3. Verify the migration
    const dbInfo = await page.evaluate(
      ({ dbName, promptsStore, sessionsStore, snippetsStore, v3Version }) => {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onsuccess = () => {
            const db = request.result;
            const version = db.version;
            const storeNames = Array.from(db.objectStoreNames);

            const tx = db.transaction([promptsStore, sessionsStore], 'readonly');
            const promptReq = tx.objectStore(promptsStore).get(MOCK_SYSTEM_PROMPT.name);
            const sessionReq = tx.objectStore(sessionsStore).get(MOCK_CHAT_SESSION.session_id);

            let prompt: SystemPrompt | undefined;
            let session: any;

            promptReq.onsuccess = () => {
              prompt = promptReq.result;
            };
            sessionReq.onsuccess = () => {
              session = sessionReq.result;
            };

            tx.oncomplete = () => {
              db.close();
              resolve({ version, storeNames, prompt, session });
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        });
      },
      {
        dbName: DB_NAME,
        promptsStore: V2_SYSTEM_PROMPTS_STORE_NAME,
        sessionsStore: V2_CHAT_SESSIONS_STORE_NAME,
        snippetsStore: V3_SNIPPETS_STORE_NAME,
        v3Version: V3_DB_VERSION,
      }
    );

    // Assertions
    expect(dbInfo.version).toBe(V3_DB_VERSION);
    expect(dbInfo.storeNames).toContain(V3_SNIPPETS_STORE_NAME);
    expect(dbInfo.storeNames).toContain(V2_SYSTEM_PROMPTS_STORE_NAME);
    expect(dbInfo.storeNames).toContain(V2_CHAT_SESSIONS_STORE_NAME);
    expect(dbInfo.prompt).toEqual(MOCK_SYSTEM_PROMPT);
    expect(dbInfo.session).toEqual(MOCK_CHAT_SESSION);
  });
});
