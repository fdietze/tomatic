import { openDB, DBSchema } from 'idb';
import { z } from 'zod';
import type { ChatSession } from '@/types/chat';

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
  model_name: z.string().nullable().optional(),
  cost: messageCostSchema.nullable().optional(),
});

const chatSessionSchema = z.object({
  session_id: z.string(),
  messages: z.array(messageSchema),
  name: z.string().nullable().optional(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
});

// --- IndexedDB Constants ---
const DB_NAME = 'tomatic_chat_db';
const DB_VERSION = 2;
const SESSIONS_STORE_NAME = 'chat_sessions';
const SESSION_ID_KEY_PATH = 'session_id';
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
}

// --- Database Interaction Functions ---

async function getDb() {
  return openDB<TomaticDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains(SESSIONS_STORE_NAME)) {
            const store = tx.objectStore(SESSIONS_STORE_NAME);
            if (!store.indexNames.contains(UPDATED_AT_INDEX)) {
                store.createIndex(UPDATED_AT_INDEX, 'updated_at_ms');
            }
        } else {
             const store = db.createObjectStore(SESSIONS_STORE_NAME, {
                keyPath: SESSION_ID_KEY_PATH,
            });
            store.createIndex(UPDATED_AT_INDEX, 'updated_at_ms');
        }
      }
    },
  });
}

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await getDb();
  try {
    await db.put(SESSIONS_STORE_NAME, session);
  } catch (error) {
    console.error('[DB] Save: Failed to save session:', error);
    throw new Error('Failed to save session.');
  } finally {
    db.close();
  }
}

export async function loadSession(sessionId: string): Promise<ChatSession | null> {
  const db = await getDb();
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
  } finally {
    db.close();
  }
}

export async function findNeighbourSessionIds(
  currentSession: ChatSession,
): Promise<{ prevId: string | null; nextId: string | null }> {
  const db = await getDb();
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
    const prevId = prevCursor ? (prevCursor.primaryKey as string) : null;

    // Query for the next (newer) session ID
    const nextCursor = await index.openKeyCursor(
      IDBKeyRange.lowerBound(currentTimestamp, true), // keys > currentTimestamp
      'next', // Go forwards from the lower bound to get the oldest of the newer sessions
    );
    const nextId = nextCursor ? (nextCursor.primaryKey as string) : null;

    await tx.done;
    return { prevId, nextId };
  } catch (error) {
    console.error(
      `[DB] findNeighbourSessionIds: Failed to find neighbors for '${currentSession.session_id}':`,
      error,
    );
    return { prevId: null, nextId: null };
  } finally {
    db.close();
  }
}

export async function getMostRecentSessionId(): Promise<string | null> {
  const db = await getDb();
  try {
    const cursor = await db
      .transaction(SESSIONS_STORE_NAME, 'readonly')
      .store.index(UPDATED_AT_INDEX)
      .openKeyCursor(null, 'prev'); // 'prev' direction gets the newest item first

    return cursor ? (cursor.primaryKey as string) : null;
  } catch (error) {
    console.error('[DB] getMostRecentSessionId: Failed to get most recent session key:', error);
    return null;
  } finally {
    db.close();
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await getDb();
  try {
    await db.delete(SESSIONS_STORE_NAME, sessionId);
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete session '${sessionId}':`, error);
    throw new Error('Failed to delete session.');
  } finally {
    db.close();
  }
}
