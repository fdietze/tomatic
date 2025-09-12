import { openDB, DBSchema } from 'idb';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ChatSession, Message } from '@/types/chat';
import type { Snippet, SystemPrompt } from '@/types/storage';

// For DB version < 2
type V1Message = Omit<Message, 'id' | 'prompt_name'> & { id?: string, prompt_name?: string | null };

// For DB version < 3
type V2Snippet = Omit<Snippet, 'createdAt_ms' | 'updatedAt_ms' | 'generationError' | 'isDirty'>;


// --- Zod Schemas for Runtime Validation ---
const messageCostSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
});

const messageSchema = z.object({
  id: z.string(),
  prompt_name: z.string().nullable().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  raw_content: z.string().optional(),
  model_name: z.string().nullable().optional(),
  cost: messageCostSchema.nullable().optional(),
});

const chatSessionSchema = z.object({
  session_id: z.string(),
  messages: z.array(messageSchema),
  name: z.string().nullable().optional(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  prompt_name: z.string().nullable().optional(), // Added from session-navigation.spec.ts
});

const systemPromptSchema = z.object({
  name: z.string(),
  prompt: z.string(),
});

const snippetSchema = z.object({
  name: z.string(),
  content: z.string(),
  isGenerated: z.boolean(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  createdAt_ms: z.number(),
  updatedAt_ms: z.number(),
  generationError: z.string().nullable(),
  isDirty: z.boolean(),
});


// --- IndexedDB Constants ---
const DB_NAME = 'tomatic_chat_db';
const DB_VERSION = 3;
const SESSIONS_STORE_NAME = 'chat_sessions';
const SYSTEM_PROMPTS_STORE_NAME = 'system_prompts';
const SNIPPETS_STORE_NAME = 'snippets';
const SESSION_ID_KEY_PATH = 'session_id';
const NAME_KEY_PATH = 'name';
const UPDATED_AT_INDEX = 'updated_at_ms';

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

const dbPromise = openDB<TomaticDB>(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion < 2) {
      console.log('[DB] Upgrading database from version 1 to 2...');
      // Create sessions store
      if (!db.objectStoreNames.contains(SESSIONS_STORE_NAME)) {
        const store = db.createObjectStore(SESSIONS_STORE_NAME, { keyPath: SESSION_ID_KEY_PATH });
        store.createIndex(UPDATED_AT_INDEX, 'updated_at_ms');
      }

      // Create system prompts store
      if (!db.objectStoreNames.contains(SYSTEM_PROMPTS_STORE_NAME)) {
        db.createObjectStore(SYSTEM_PROMPTS_STORE_NAME, { keyPath: NAME_KEY_PATH });
      }
      
      // Migrate data
      void (tx.objectStore(SESSIONS_STORE_NAME).openCursor()).then(function migrate(cursor) {
        if (!cursor) {
          console.log('[DB] Migration complete.');
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
              id: m.id || uuidv4(),
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
      console.log('[DB] Upgrading database from version 2 to 3...');
      if (!db.objectStoreNames.contains(SNIPPETS_STORE_NAME)) {
        db.createObjectStore(SNIPPETS_STORE_NAME, { keyPath: NAME_KEY_PATH });
      }

      // Migrate existing snippets to include new fields for regeneration tracking
      void tx.objectStore(SNIPPETS_STORE_NAME).openCursor().then(function migrateSnippets(cursor) {
        if (!cursor) return;
        
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

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await dbPromise;
  try {
    await db.put(SESSIONS_STORE_NAME, session);
  } catch (error) {
    console.error('[DB] Save: Failed to save session:', error);
    throw new Error('Failed to save session.');
  }
}

export async function loadSession(sessionId: string): Promise<ChatSession | null> {
  const db = await dbPromise;
  try {
    const result = await db.get(SESSIONS_STORE_NAME, sessionId);
    if (!result) {
      return null;
    }
    // Validate data from DB against our schema at runtime
    const validation = chatSessionSchema.safeParse(result);
    if (validation.success) {
      return validation.data;
    } else {
      console.error('[DB] Load: Zod validation failed for session:', validation.error);
      // Optional: Could try to delete the corrupted session
      // await deleteSession(sessionId);
      return null;
    }
  } catch (error) {
    console.error(`[DB] Load: Failed to load session '${sessionId}':`, error);
    throw new Error('Failed to load session.');
  }
}

export async function findNeighbourSessionIds(
  currentSession: ChatSession,
): Promise<{ prevId: string | null; nextId: string | null }> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SESSIONS_STORE_NAME, 'readonly');
    const store = tx.store;
    const index = store.index(UPDATED_AT_INDEX);
    const currentTimestamp = currentSession.updated_at_ms;

    // Query for the previous (older) session ID
    const prevCursor = await index.openKeyCursor(
      IDBKeyRange.upperBound(currentTimestamp, true), // keys < currentTimestamp
      'prev', // Go backwards from the upper bound to get the newest of the older sessions
    );
    const prevId = prevCursor ? prevCursor.primaryKey : null;

    // Query for the next (newer) session ID
    const nextCursor = await index.openKeyCursor(
      IDBKeyRange.lowerBound(currentTimestamp, true), // keys > currentTimestamp
      'next', // Go forwards from the lower bound to get the oldest of the newer sessions
    );
    const nextId = nextCursor ? nextCursor.primaryKey : null;

    await tx.done;
    return { prevId, nextId };
  } catch (error) {
    console.error(
      `[DB] findNeighbourSessionIds: Failed to find neighbors for '${currentSession.session_id}':`,
      error,
    );
    return { prevId: null, nextId: null };
  }
}

export async function getMostRecentSessionId(): Promise<string | null> {
  const db = await dbPromise;
  try {
    const cursor = await db
      .transaction(SESSIONS_STORE_NAME, 'readonly')
      .store.index(UPDATED_AT_INDEX)
      .openKeyCursor(null, 'prev'); // 'prev' direction gets the newest item first

    return cursor ? cursor.primaryKey : null;
  } catch (error) {
    console.error('[DB] getMostRecentSessionId: Failed to get most recent session key:', error);
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await dbPromise;
  try {
    await db.delete(SESSIONS_STORE_NAME, sessionId);
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete session '${sessionId}':`, error);
    throw new Error('Failed to delete session.');
  }
}


// --- System Prompt CRUD ---

export async function saveSystemPrompt(prompt: SystemPrompt): Promise<void> {
  const db = await dbPromise;
  try {
    await db.put(SYSTEM_PROMPTS_STORE_NAME, prompt);
  } catch (error) {
    console.error('[DB] Save: Failed to save system prompt:', error);
    throw new Error('Failed to save system prompt.');
  }
}

export async function loadAllSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await dbPromise;
  try {
    const prompts = await db.getAll(SYSTEM_PROMPTS_STORE_NAME);
    // Validate each prompt
    const validation = z.array(systemPromptSchema).safeParse(prompts);
    if (validation.success) {
      return validation.data;
    } else {
      console.error('[DB] Load: Zod validation failed for system prompts:', validation.error);
      return [];
    }
  } catch (error) {
    console.error('[DB] Load: Failed to load system prompts:', error);
    throw new Error('Failed to load system prompts.');
  }
}

export async function deleteSystemPrompt(promptName: string): Promise<void> {
  const db = await dbPromise;
  try {
    await db.delete(SYSTEM_PROMPTS_STORE_NAME, promptName);
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete system prompt '${promptName}':`, error);
    throw new Error('Failed to delete system prompt.');
  }
}


// --- Snippet CRUD ---

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const db = await dbPromise;
  const now = Date.now();
  const snippetToSave: Snippet = {
    ...snippet,
    createdAt_ms: snippet.createdAt_ms || now,
    updatedAt_ms: now,
  };
  try {
    await db.put(SNIPPETS_STORE_NAME, snippetToSave);
  } catch (error) {
    console.error('[DB] Save: Failed to save snippet:', error);
    throw new Error('Failed to save snippet.');
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
      console.error('[DB] Load: Zod validation failed for snippets:', validation.error);
      return [];
    }
  } catch (error) {
    console.error('[DB] Load: Failed to load snippets:', error);
    throw new Error('Failed to load snippets.');
  }
}

export async function deleteSnippet(name: string): Promise<void> {
  const db = await dbPromise;
  try {
    await db.delete(SNIPPETS_STORE_NAME, name);
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete snippet '${name}':`, error);
    throw new Error('Failed to delete snippet.');
  }
}

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SNIPPETS_STORE_NAME, 'readwrite');
  try {
    await Promise.all(snippets.map(s => tx.store.put(s)));
    await tx.done;
  } catch (error) {
    console.error('[DB] Save: Failed to save multiple snippets:', error);
    throw new Error('Failed to save snippets.');
  }
}
