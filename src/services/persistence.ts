import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatSession, Message } from "@/types/chat";
import type { Snippet, SystemPrompt } from "@/types/storage";
import { z } from "zod";
import { snippetSchema, systemPromptSchema } from "@/services/db/schemas";
import { dispatchEvent } from "@/utils/events";

// For DB version < 2
type V1Message = Omit<Message, "id" | "prompt_name"> & {
  id?: string;
  prompt_name?: string | null;
};

// For DB version < 3
type V2Snippet = Omit<
  Snippet,
  "id" | "createdAt_ms" | "updatedAt_ms" | "generationError" | "isDirty"
>;

// --- IndexedDB Constants ---
export const DB_NAME = "tomatic_chat_db";
export const DB_VERSION = 3;
export const SESSIONS_STORE_NAME = "chat_sessions";
export const SYSTEM_PROMPTS_STORE_NAME = "system_prompts";
export const SNIPPETS_STORE_NAME = "snippets";
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

        // Migrate data
        void tx
          .objectStore(SESSIONS_STORE_NAME)
          .openCursor()
          .then(function migrate(cursor) {
            if (!cursor) {
              dispatchEvent("db_migration_complete", { from: 1, to: 2 });
              return;
            }

            const oldSession = cursor.value;

            // V2 introduces optional `name` on sessions and required `id` and optional `prompt_name` on messages
            const newSession: ChatSession = {
              ...oldSession,
              name: oldSession.name || null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              messages: (oldSession.messages as any[]).map((m: V1Message) => {
                const newMessage: Message = {
                  ...m,
                  id: m.id || crypto.randomUUID(),
                  prompt_name: m.prompt_name || null,
                };
                return newMessage;
              }),
            };

            void cursor.update(newSession);
            void cursor.continue().then(migrate);
          });
      }
      // req:database-migrations: V3 introduces snippets
      if (oldVersion < 3) {
        // V3 introduces snippets. If the store exists from a pre-release version keyed by name,
        // we need to rebuild it to be keyed by a new `id` field.
        const storeExists = db.objectStoreNames.contains(SNIPPETS_STORE_NAME);
        
        const migrationLogic = async () => {
          if (storeExists) {
            const oldSnippets = await tx.objectStore(SNIPPETS_STORE_NAME).getAll() as V2Snippet[];
            db.deleteObjectStore(SNIPPETS_STORE_NAME);
            const newStore = db.createObjectStore(SNIPPETS_STORE_NAME, {
              keyPath: "id",
            });
            newStore.createIndex(SNIPPET_NAME_INDEX, "name", { unique: true });
            const now = Date.now();
            oldSnippets.forEach((oldSnippet) => {
            // req:snippet-dirty-indexeddb: Snippets have isDirty flag for resuming generation
            const newSnippet: Snippet = {
              id: crypto.randomUUID(),
              ...oldSnippet,
              createdAt_ms: now,
              updatedAt_ms: now,
              generationError: null,
              isDirty: false,
            };
              void newStore.put(newSnippet);
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
    },
  }).then((db) => ({ db, migrated }));
  return dbInstancePromise;
}

export const dbPromise = openTomaticDB().then((result) => result.db);
export const migrationPromise = openTomaticDB().then((result) => result.migrated);

// --- Snippet Functions ---

export async function saveSnippet(snippet: Snippet): Promise<void> {
  console.log("[DEBUG] saveSnippet: starting save for snippet:", {id: snippet.id, name: snippet.name, content: snippet.content});
  const db = await dbPromise;
  const now = Date.now();
  const snippetToSave: Snippet = {
    ...snippet,
    id: snippet.id || crypto.randomUUID(),
    createdAt_ms: snippet.createdAt_ms || now,
    updatedAt_ms: now,
  };
  console.log("[DEBUG] saveSnippet: prepared snippet for save:", {id: snippetToSave.id, name: snippetToSave.name, content: snippetToSave.content});
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    console.log("[DEBUG] saveSnippet: transaction created, putting snippet");
    await tx.store.put(snippetToSave);
    console.log("[DEBUG] saveSnippet: put completed, waiting for transaction");
    await tx.done;
    console.log("[DEBUG] saveSnippet: transaction completed successfully");
  } catch (e) {
    console.error("[DB|saveSnippet] Failed to save snippet:", e);
    throw new Error("Failed to save snippet.");
  }
}

export async function loadAllSnippets(): Promise<Snippet[]> {
  console.log("[DEBUG] loadAllSnippets: starting load from database");
  const db = await dbPromise;
  try {
    const snippets = await db.getAll(SNIPPETS_STORE_NAME);
    console.log("[DEBUG] loadAllSnippets: loaded raw snippets from DB:", snippets.map(s => ({id: s.id, name: s.name, content: s.content})));
    // Validate each snippet
    const validation = z.array(snippetSchema).safeParse(snippets);
    if (validation.success) {
      return validation.data;
    } else {
      return [];
    }
  } catch {
    throw new Error("Failed to load snippets.");
  }
}

export async function deleteSnippet(id: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    await tx.store.delete(id);
    await tx.done;
  } catch (e) {
    console.error("[DB|deleteSnippet] Failed to delete snippet:", e);
    throw new Error("Failed to delete snippet.");
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
  } catch {
    throw new Error("Failed to save snippets.");
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
    console.error("[DB] Save: Failed to save system prompt:", error);
    throw new Error("Failed to save system prompt.");
  }
}

export async function loadAllSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await dbPromise;
  try {
    console.log('[DEBUG] loadAllSystemPrompts: starting load from database');
    const prompts = await db.getAll(SYSTEM_PROMPTS_STORE_NAME);
    console.log('[DEBUG] loadAllSystemPrompts: found', prompts.length, 'prompts in database');
    const validation = z.array(systemPromptSchema).safeParse(prompts);
    if (validation.success) {
      return validation.data;
    } else {
      console.log('[DEBUG] loadAllSystemPrompts: validation failed:', validation.error);
      console.error(
        "[DB] Load: Zod validation failed for system prompts:",
        validation.error,
      );
      return [];
    }
  } catch (error) {
    console.log('[DEBUG] loadAllSystemPrompts: exception occurred:', error);
    console.error("[DB] Load: Failed to load system prompts:", error);
    throw new Error("Failed to load system prompts.");
  }
}

export async function deleteSystemPrompt(promptName: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SYSTEM_PROMPTS_STORE_NAME, "readwrite");
    await tx.store.delete(promptName);
    await tx.done;
  } catch (error) {
    console.error(
      `[DB] Delete: Failed to delete system prompt '${promptName}':`,
      error,
    );
    throw new Error("Failed to delete system prompt.");
  }
}
