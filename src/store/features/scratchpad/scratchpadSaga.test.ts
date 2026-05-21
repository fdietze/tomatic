import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { runSaga, stdChannel } from 'redux-saga';
import {
  loadSessionSuccess,
  startNewSession,
  setHasSessions,
} from './scratchpadSlice';

// Mock NavigationProvider so sagas that call getNavigationService don't throw in tests
vi.mock('@/services/NavigationProvider', () => ({
  getNavigationService: () => ({ navigate: vi.fn(), replace: vi.fn() }),
}));

// Mock events module to avoid window-related errors in Node test environment
vi.mock('@/utils/events', () => ({
  dispatchEvent: vi.fn(),
}));

describe('scratchpadSaga.loadSessionWorker', () => {
  beforeEach(async () => {
    // Purpose: ensure a clean DB per test — close the db singleton, reset modules,
    // then delete the DB so the next dynamic import opens a fresh empty database.
    const { closeDbForTesting } = await import('@/services/persistence');
    await closeDbForTesting();
    vi.resetModules();
    const { deleteDB } = await import('idb');
    await deleteDB('tomatic_chat_db');
  });

  it('loads an existing session and reports neighbours', async () => {
    // Purpose: navigating to /scratchpad/:id hydrates state from IndexedDB
    const { saveScratchpadSession } = await import('@/services/db/scratchpad-sessions');
    await saveScratchpadSession({
      session_id: 'x',
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 1,
    });
    const { loadSessionWorker } = await import('./scratchpadSaga');
    const { loadSession } = await import('./scratchpadSlice');
    const dispatched: any[] = [];
    await runSaga(
      { channel: stdChannel(), dispatch: (a) => dispatched.push(a), getState: () => ({}) },
      loadSessionWorker as any,
      loadSession('x'),
    ).toPromise();
    const success = dispatched.find((a) => a.type === loadSessionSuccess.type);
    expect(success).toBeTruthy();
    expect(success.payload.session.session_id).toBe('x');
    expect(success.payload.prevId).toBeNull();
    expect(success.payload.nextId).toBeNull();
  });

  it('treats "new" as startNewSession and reports hasSessions', async () => {
    // Purpose: /scratchpad/new yields an empty in-memory session; sidebar still knows whether sessions exist
    const { saveScratchpadSession } = await import('@/services/db/scratchpad-sessions');
    await saveScratchpadSession({
      session_id: 'y',
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 1,
    });
    const { loadSessionWorker } = await import('./scratchpadSaga');
    const { loadSession } = await import('./scratchpadSlice');
    const dispatched: any[] = [];
    await runSaga(
      { channel: stdChannel(), dispatch: (a) => dispatched.push(a), getState: () => ({}) },
      loadSessionWorker as any,
      loadSession('new'),
    ).toPromise();
    expect(dispatched.find((a) => a.type === startNewSession.type)).toBeTruthy();
    expect(dispatched).toContainEqual(setHasSessions(true));
  });
});
