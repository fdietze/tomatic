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
  "createdAt_ms" | "updatedAt_ms" | "generationError" | "isDirty"
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
  };
}

// --- Database Interaction Functions ---

function openTomaticDB(): Promise<IDBPDatabase<TomaticDB>> {
  return openDB<TomaticDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
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
      if (oldVersion < 3) {
        // Create snippets store
        if (!db.objectStoreNames.contains(SNIPPETS_STORE_NAME)) {
          db.createObjectStore(SNIPPETS_STORE_NAME, { keyPath: NAME_KEY_PATH });
        }

        // Migrate existing snippets to include new fields for regeneration tracking
        void tx
          .objectStore(SNIPPETS_STORE_NAME)
          .openCursor()
          .then(function migrateSnippets(cursor) {
            if (!cursor) {
              dispatchEvent("db_migration_complete", { from: 2, to: 3 });
              return;
            }

            const oldSnippet = cursor.value as V2Snippet;
            const now = Date.now();

            const newSnippet: Snippet = {
              ...oldSnippet,
              createdAt_ms: now,
              updatedAt_ms: now,
              generationError: null,
              isDirty: false,
            };

            void cursor.update(newSnippet);
            void cursor.continue().then(migrateSnippets);
          });
      }
    },
  });
}

const dbPromise = openTomaticDB();

export { dbPromise, openTomaticDB };

// --- Snippet Functions ---

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const db = await dbPromise;
  const now = Date.now();
  const snippetToSave: Snippet = {
    ...snippet,
    createdAt_ms: snippet.createdAt_ms || now,
    updatedAt_ms: now,
  };
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    await tx.store.put(snippetToSave);
    await tx.done;
  } catch (e) {
    console.error("[DB|saveSnippet] Failed to save snippet:", e);
    throw new Error("Failed to save snippet.");
  }
}

export async function loadAllSnippets(): Promise<Snippet[]> {
  const db = await dbPromise;
  try {
    const snippets = await db.getAll(SNIPPETS_STORE_NAME);
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

export async function deleteSnippet(name: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SNIPPETS_STORE_NAME, "readwrite");
    await tx.store.delete(name);
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
      return tx.store.put(s);
    });
    await Promise.all(putPromises);
    await tx.done;
  } catch {
    throw new Error("Failed to save snippets.");
  }
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
    const prompts = await db.getAll(SYSTEM_PROMPTS_STORE_NAME);
    const validation = z.array(systemPromptSchema).safeParse(prompts);
    if (validation.success) {
      return validation.data;
    } else {
      console.error(
        "[DB] Load: Zod validation failed for system prompts:",
        validation.error,
      );
      return [];
    }
  } catch (error) {
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
