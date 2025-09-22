import { dbPromise, SESSIONS_STORE_NAME, UPDATED_AT_INDEX } from '../persistence';
import { chatSessionSchema } from './schemas';
import type { ChatSession } from '@/types/chat';

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SESSIONS_STORE_NAME, 'readwrite');
    await tx.store.put(session);
    await tx.done;
  } catch (error) {
    console.error('[DB] Save: Failed to save session:', error);
    throw new Error('Failed to save session.');
  }
}

export async function loadSession(sessionId: string): Promise<ChatSession | null> {
  const db = await dbPromise;
  try {
    const session = await db.get(SESSIONS_STORE_NAME, sessionId);
    if (!session) return null;

    // Validate data from DB against our schema at runtime
    const validation = chatSessionSchema.safeParse(session);
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
    const tx = db.transaction(SESSIONS_STORE_NAME, 'readwrite');
    await tx.store.delete(sessionId);
    await tx.done;
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete session '${sessionId}':`, error);
    throw new Error('Failed to delete session.');
  }
}

export async function hasSessions(): Promise<boolean> {
  const db = await dbPromise;
  const count = await db.count("chat_sessions");
  return count > 0;
}