import { dbPromise, SESSIONS_STORE_NAME, UPDATED_AT_INDEX } from '../persistence';
import { chatSessionSchema } from './schemas';
import type { ChatSession } from '@/types/chat';
import { describeError } from '@/types/errors';

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SESSIONS_STORE_NAME, 'readwrite');
    await tx.store.put(session);
    await tx.done;
  } catch (error) {
    throw new Error(`Failed to save session: ${describeError(error)}`);
  }
}

export async function loadSession(sessionId: string): Promise<ChatSession | null> {
  const db = await dbPromise;
  const session = await db.get(SESSIONS_STORE_NAME, sessionId);
  if (!session) return null;

  // Parse, Don't Validate: a corrupted session is an error, not a missing one.
  const validation = chatSessionSchema.safeParse(session);
  if (!validation.success) {
    throw new Error(`Stored session '${sessionId}' is invalid: ${validation.error.message}`);
  }
  return validation.data;
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
    // Handled degradation: without neighbours only the prev/next navigation is unavailable.
    console.log(`[DB] findNeighbourSessionIds: no neighbours for '${currentSession.session_id}':`, error);
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
    // Handled degradation: the app starts with a new chat instead of the most recent one.
    console.log('[DB] getMostRecentSessionId: failed to get most recent session key:', error);
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SESSIONS_STORE_NAME, 'readwrite');
    await tx.store.delete(sessionId);
    await tx.done;
  } catch (error) {
    throw new Error(`Failed to delete session '${sessionId}': ${describeError(error)}`);
  }
}

export async function hasSessions(): Promise<boolean> {
  const db = await dbPromise;
  const count = await db.count("chat_sessions");
  return count > 0;
}