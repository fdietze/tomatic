import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatSession } from "@/types/chat";
import type { ScratchpadSession } from "@/types/scratchpad";
import type { Snippet, SystemPrompt } from "@/types/storage";
import { z } from "zod";
import { snippetSchema, systemPromptSchema } from "@/services/db/schemas";
import { dispatchEvent } from "@/utils/events";
import { describeError } from "@/types/errors";
import { 
  CURRENT_INDEXEDDB_VERSION,
  migrateV2SnippetsToV3,
} from "./persistence/migrations";

// --- IndexedDB Constants ---
export const DB_NAME = "tomatic_chat_db";
export const DB_VERSION = CURRENT_INDEXEDDB_VERSION;
export const SESSIONS_STORE_NAME = "chat_sessions";
export const SYSTEM_PROMPTS_STORE_NAME = "system_prompts";
export const SNIPPETS_STORE_NAME = "snippets";
export const SCRATCHPAD_SESSIONS_STORE_NAME = "scratchpad_sessions";
export const SESSION_ID_KEY_PATH = "session_id";
export const NAME_KEY_PATH = "name";
export const UPDATED_AT_INDEX = "updated_at_ms";
export const SNIPPET_NAME_INDEX = "name_idx";

// --- IDB Schema Definition ---
interface TomaticDB extends DBSchema {
  [SESSIONS_STORE_NAME]: {
    key: string;
    value: ChatSession;
    indexes: {
      [UPDATED_AT_INDEX]: number;
    };
  };
  [SYSTEM_PROMPTS_STORE_NAME]: {
    key: string;
    value: SystemPrompt;
  };
  [SNIPPETS_STORE_NAME]: {
    key: string;
    value: Snippet;
    indexes: {
      [SNIPPET_NAME_INDEX]: string;
    };
  };
  [SCRATCHPAD_SESSIONS_STORE_NAME]: {
    key: string;
    value: ScratchpadSession;
    indexes: {
      [UPDATED_AT_INDEX]: number;
    };
  };
}

let dbInstancePromise: Promise<{
  db: IDBPDatabase<TomaticDB>;
  migrated: boolean;
}> | null = null;

function openTomaticDB(): Promise<{
  db: IDBPDatabase<TomaticDB>;
  migrated: boolean;
}> {
  if (dbInstancePromise) {
    return dbInstancePromise;
  }
  let migrated = false;
  dbInstancePromise = openDB<TomaticDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion > 0) {
        migrated = true;
      }
      // Create base stores (needed for fresh databases in tests and new installs)
      if (oldVersion < 2) {
        // Create sessions store
        if (!db.objectStoreNames.contains(SESSIONS_STORE_NAME)) {
          const store = db.createObjectStore(SESSIONS_STORE_NAME, {
            keyPath: SESSION_ID_KEY_PATH,
          });
          store.createIndex(UPDATED_AT_INDEX, "updated_at_ms");
        }

        // Create system prompts store
        if (!db.objectStoreNames.contains(SYSTEM_PROMPTS_STORE_NAME)) {
          db.createObjectStore(SYSTEM_PROMPTS_STORE_NAME, {
            keyPath: NAME_KEY_PATH,
          });
        }
      }
      // req:database-migrations: V3 introduces snippets
      if (oldVersion < 3) {
        // V3 introduces snippets. If the store exists from a pre-release version keyed by name,
        // we need to rebuild it to be keyed by a new `id` field.
        const storeExists = db.objectStoreNames.contains(SNIPPETS_STORE_NAME);
        const migrationLogic = async () => {
          if (storeExists) {
            const oldSnippets = await tx.objectStore(SNIPPETS_STORE_NAME).getAll();
            db.deleteObjectStore(SNIPPETS_STORE_NAME);
            const newStore = db.createObjectStore(SNIPPETS_STORE_NAME, {
              keyPath: "id",
            });
            newStore.createIndex(SNIPPET_NAME_INDEX, "name", { unique: true });
            // Use centralized migration logic
            const migratedSnippets = migrateV2SnippetsToV3(oldSnippets);
            migratedSnippets.forEach((snippet) => {
              void newStore.put(snippet);
            });
          } else {
            const newStore = db.createObjectStore(SNIPPETS_STORE_NAME, { keyPath: "id" });
            newStore.createIndex(SNIPPET_NAME_INDEX, "name", { unique: true });
          }
        };

        // req:migration-events: The migration logic is now wrapped in a promise to ensure it completes
        // before the transaction is automatically committed.
        void migrationLogic().then(() => {
          dispatchEvent("db_migration_complete", { from: 2, to: 3 });
        });
      }

      // req:scratchpad-separate-sessions: v4 introduces scratchpad_sessions store
      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains(SCRATCHPAD_SESSIONS_STORE_NAME)) {
          const store = db.createObjectStore(SCRATCHPAD_SESSIONS_STORE_NAME, {
            keyPath: SESSION_ID_KEY_PATH,
          });
          store.createIndex(UPDATED_AT_INDEX, "updated_at_ms");
        }
      }

      // req:scratchpad-include-last-response-persisted: v5 adds include_last_response
      // to scratchpad sessions. No store/index changes; the zod schema lazily backfills
      // `false` when loading older rows. Version bump alone is sufficient.
      if (oldVersion < 5) {
        // intentionally empty
      }
    },
  }).then((db) => ({ db, migrated }));
  return dbInstancePromise;
}

export const dbPromise = openTomaticDB().then((result) => result.db);
export const migrationPromise = openTomaticDB().then((result) => result.migrated);

// Closes the active DB connection and resets the module-level singleton.
// Only intended for use in tests that need to delete and re-create the database
// between test runs (e.g., via fake-indexeddb/auto + idb's deleteDB).
export async function closeDbForTesting(): Promise<void> {
  if (dbInstancePromise) {
    const { db } = await dbInstancePromise;
    db.close();
    dbInstancePromise = null;
  }
}

// --- Snippet Functions ---

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const db = await dbPromise;
  const now = Date.now();
  const snippetToSave: Snippet = {
    ...snippet,
    id: snippet.id || crypto.randomUUID(),
    createdAt_ms: snippet.createdAt_ms || now,
    updatedAt_ms: now,
  };
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    await tx.store.put(snippetToSave);
    await tx.done;
  } catch (e) {
    throw new Error(`Failed to save snippet: ${describeError(e)}`);
  }
}

export async function loadAllSnippets(): Promise<Snippet[]> {
  const db = await dbPromise;
  const snippets = await db.getAll(SNIPPETS_STORE_NAME);
  // req:snippet-storage-errors-visible: Parse, Don't Validate - an invalid record fails the load
  // visibly instead of hiding every snippet behind an empty list.
  const validation = z.array(snippetSchema).safeParse(snippets);
  if (!validation.success) {
    throw new Error(`Stored snippets are invalid: ${validation.error.message}`);
  }
  return validation.data;
}

export async function deleteSnippet(id: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    await tx.store.delete(id);
    await tx.done;
  } catch (e) {
    throw new Error(`Failed to delete snippet: ${describeError(e)}`);
  }
}

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
  try {
    const putPromises = snippets.map((s) => {
      const snippetToSave: Snippet = {
        ...s,
        id: s.id || crypto.randomUUID(),
      };
      return tx.store.put(snippetToSave);
    });
    await Promise.all(putPromises);
    await tx.done;
  } catch (e) {
    throw new Error(`Failed to save snippets: ${describeError(e)}`);
  }
}

export async function clearAllSnippets(): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    await tx.store.clear();
    await tx.done;
  } catch (e) {
    throw new Error(`Failed to clear snippets: ${describeError(e)}`);
  }
}

export async function updateSnippetProperty(
  id: string,
  properties: Partial<Snippet>,
): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
  const store = tx.objectStore(SNIPPETS_STORE_NAME);
  const snippet = await store.get(id);
  if (snippet) {
    const updatedSnippet = { ...snippet, ...properties };
    await store.put(updatedSnippet);
  }
  await tx.done;
}

// --- System Prompt Functions ---

export async function saveSystemPrompt(prompt: SystemPrompt): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SYSTEM_PROMPTS_STORE_NAME, "readwrite");
    await tx.store.put(prompt);
    await tx.done;
  } catch (error) {
    throw new Error(`Failed to save system prompt: ${describeError(error)}`);
  }
}

export async function loadAllSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await dbPromise;
  const prompts = await db.getAll(SYSTEM_PROMPTS_STORE_NAME);
  // Parse, Don't Validate: an invalid record fails the load visibly instead of returning an empty list.
  const validation = z.array(systemPromptSchema).safeParse(prompts);
  if (!validation.success) {
    throw new Error(`Stored system prompts are invalid: ${validation.error.message}`);
  }
  return validation.data;
}

export async function deleteSystemPrompt(promptName: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SYSTEM_PROMPTS_STORE_NAME, "readwrite");
    await tx.store.delete(promptName);
    await tx.done;
  } catch (error) {
    throw new Error(`Failed to delete system prompt '${promptName}': ${describeError(error)}`);
  }
}
