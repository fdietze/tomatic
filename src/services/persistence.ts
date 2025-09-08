import { openDB, DBSchema } from 'idb';
import { z } from 'zod';
import type { ChatSession } from '@/types/chat';

// --- Zod Schemas for Runtime Validation ---
const messageCostSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
});

const messageSchema = z.object({
  prompt_name: z.string().nullable(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  model_name: z.string().nullable(),
  cost: messageCostSchema.nullable(),
});

const chatSessionSchema = z.object({
  session_id: z.string(),
  messages: z.array(messageSchema),
  name: z.string().nullable(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  prompt_name: z.string().nullable(),
});

// --- IndexedDB Constants ---
const DB_NAME = 'tomatic_chat_db';
const DB_VERSION = 1;
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
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(SESSIONS_STORE_NAME, {
          keyPath: SESSION_ID_KEY_PATH,
        });
        store.createIndex(UPDATED_AT_INDEX, 'updated_at_ms');
      }
    },
  });
}

export async function saveSession(session: ChatSession): Promise<void> {
  try {
    const db = await getDb();
    await db.put(SESSIONS_STORE_NAME, session);
  } catch (error) {
    console.error('[DB] Save: Failed to save session:', error);
    throw new Error('Failed to save session.');
  }
}

export async function loadSession(sessionId: string): Promise<ChatSession | null> {
  try {
    const db = await getDb();
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

export async function getAllSessionKeysSortedByUpdate(): Promise<string[]> {
  try {
    const db = await getDb();
    const keys = await db.getAllKeysFromIndex(
      SESSIONS_STORE_NAME,
      UPDATED_AT_INDEX,
    );
    // The keys are sorted ascending by default, we want descending (newest first).
    return keys.reverse();
  } catch (error) {
    console.error('[DB] ListKeys: Failed to get all session keys:', error);
    throw new Error('Failed to get session keys.');
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(SESSIONS_STORE_NAME, sessionId);
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete session '${sessionId}':`, error);
    throw new Error('Failed to delete session.');
  }
}
