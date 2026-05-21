import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ScratchpadSession } from '@/types/scratchpad';

const mk = (id: string, updated_at_ms: number): ScratchpadSession => ({
  session_id: id,
  inputs: [],
  response: null,
  created_at_ms: updated_at_ms,
  updated_at_ms,
});

// Mock events module to avoid window-related errors in Node test environment
vi.mock('@/utils/events', () => ({
  dispatchEvent: vi.fn(),
}));

describe('scratchpad-sessions CRUD', () => {
  beforeEach(async () => {
    // Purpose: ensure a clean DB per test. We must close the DB connection before
    // calling deleteDB (otherwise it blocks), then reset modules so the next
    // dynamic import of `../persistence` creates a fresh dbPromise pointing at
    // the newly opened (empty) database.
    const { closeDbForTesting } = await import('../persistence');
    await closeDbForTesting();
    vi.resetModules();
    const { deleteDB } = await import('idb');
    await deleteDB('tomatic_chat_db');
  });

  it('saves and loads a session round-trip', async () => {
    // Purpose: round-trip persistence works through the Zod schema
    const { saveScratchpadSession, loadScratchpadSession } = await import('./scratchpad-sessions');
    await saveScratchpadSession(mk('s1', 10));
    const loaded = await loadScratchpadSession('s1');
    expect(loaded?.session_id).toBe('s1');
  });

  it('returns null for unknown id', async () => {
    // Purpose: loadScratchpadSession is total — missing rows surface as null, not throw
    const { loadScratchpadSession } = await import('./scratchpad-sessions');
    expect(await loadScratchpadSession('missing')).toBeNull();
  });

  it('finds previous and next session ids by updated_at_ms', async () => {
    // Purpose: sidebar prev/next navigation depends on this ordering
    const { saveScratchpadSession, findNeighbourScratchpadIds } = await import('./scratchpad-sessions');
    await saveScratchpadSession(mk('a', 10));
    await saveScratchpadSession(mk('b', 20));
    await saveScratchpadSession(mk('c', 30));
    const nb = await findNeighbourScratchpadIds(mk('b', 20));
    expect(nb).toEqual({ prevId: 'a', nextId: 'c' });
  });

  it('returns the most recent session id', async () => {
    // Purpose: /scratchpad/new can offer "back to last" navigation
    const { saveScratchpadSession, getMostRecentScratchpadId } = await import('./scratchpad-sessions');
    await saveScratchpadSession(mk('a', 10));
    await saveScratchpadSession(mk('b', 30));
    expect(await getMostRecentScratchpadId()).toBe('b');
  });

  it('reports whether any sessions exist', async () => {
    // Purpose: enable/disable prev-button when on /scratchpad/new
    const { saveScratchpadSession, hasScratchpadSessions } = await import('./scratchpad-sessions');
    expect(await hasScratchpadSessions()).toBe(false);
    await saveScratchpadSession(mk('a', 1));
    expect(await hasScratchpadSessions()).toBe(true);
  });
});
