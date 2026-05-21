import {
  dbPromise,
  SCRATCHPAD_SESSIONS_STORE_NAME,
  UPDATED_AT_INDEX,
} from '../persistence';
import { scratchpadSessionSchema } from './scratchpadSchemas';
import type { ScratchpadSession } from '@/types/scratchpad';

export async function saveScratchpadSession(session: ScratchpadSession): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SCRATCHPAD_SESSIONS_STORE_NAME, 'readwrite');
  await tx.store.put(session);
  await tx.done;
}

export async function loadScratchpadSession(sessionId: string): Promise<ScratchpadSession | null> {
  const db = await dbPromise;
  const raw = await db.get(SCRATCHPAD_SESSIONS_STORE_NAME, sessionId);
  if (!raw) return null;
  const parsed = scratchpadSessionSchema.safeParse(raw);
  if (!parsed.success) {
    console.log('[DB] scratchpad: zod validation failed', parsed.error);
    return null;
  }
  return parsed.data;
}

export async function findNeighbourScratchpadIds(
  current: ScratchpadSession,
): Promise<{ prevId: string | null; nextId: string | null }> {
  const db = await dbPromise;
  const tx = db.transaction(SCRATCHPAD_SESSIONS_STORE_NAME, 'readonly');
  const idx = tx.store.index(UPDATED_AT_INDEX);
  const prevCursor = await idx.openKeyCursor(
    IDBKeyRange.upperBound(current.updated_at_ms, true),
    'prev',
  );
  const nextCursor = await idx.openKeyCursor(
    IDBKeyRange.lowerBound(current.updated_at_ms, true),
    'next',
  );
  await tx.done;
  return {
    prevId: prevCursor ? (prevCursor.primaryKey as string) : null,
    nextId: nextCursor ? (nextCursor.primaryKey as string) : null,
  };
}

export async function getMostRecentScratchpadId(): Promise<string | null> {
  const db = await dbPromise;
  const cursor = await db
    .transaction(SCRATCHPAD_SESSIONS_STORE_NAME, 'readonly')
    .store.index(UPDATED_AT_INDEX)
    .openKeyCursor(null, 'prev');
  return cursor ? (cursor.primaryKey as string) : null;
}

export async function deleteScratchpadSession(sessionId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(SCRATCHPAD_SESSIONS_STORE_NAME, 'readwrite');
  await tx.store.delete(sessionId);
  await tx.done;
}

export async function hasScratchpadSessions(): Promise<boolean> {
  const db = await dbPromise;
  const count = await db.count(SCRATCHPAD_SESSIONS_STORE_NAME);
  return count > 0;
}
