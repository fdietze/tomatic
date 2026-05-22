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

// Mock resolveSnippetsWithTemplates so it returns the text unchanged (no snippet DB needed)
vi.mock('@/store/features/snippets/snippetsSaga', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/store/features/snippets/snippetsSaga');
  return {
    ...actual,
    resolveSnippetsWithTemplates: vi.fn(async (s: string) => s),
  };
});

// Mock streamChat to return a predictable async iterable
vi.mock('@/services/chatService', () => ({
  streamChat: vi.fn(async () => {
    async function* gen() {
      yield { choices: [{ delta: { content: 'hi ' } }] };
      yield { choices: [{ delta: { content: 'there' } }] };
    }
    return gen();
  }),
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
      include_last_response: false,
    });
    const { loadSessionWorker } = await import('./scratchpadSaga');
    const { loadSession } = await import('./scratchpadSlice');
    const dispatched: unknown[] = [];
    await runSaga(
      { channel: stdChannel(), dispatch: (a) => dispatched.push(a), getState: () => ({}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadSessionWorker as any,
      loadSession('x'),
    ).toPromise();
    type LoadSuccessPayload = { session: { session_id: string }; prevId: string | null; nextId: string | null };
    type Action = { type: string; payload: LoadSuccessPayload };
    const success = (dispatched as Action[]).find((a) => a.type === loadSessionSuccess.type);
    expect(success).toBeTruthy();
    expect(success!.payload.session.session_id).toBe('x');
    expect(success!.payload.prevId).toBeNull();
    expect(success!.payload.nextId).toBeNull();
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
      include_last_response: false,
    });
    const { loadSessionWorker } = await import('./scratchpadSaga');
    const { loadSession } = await import('./scratchpadSlice');
    const dispatched: unknown[] = [];
    await runSaga(
      { channel: stdChannel(), dispatch: (a) => dispatched.push(a), getState: () => ({}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadSessionWorker as any,
      loadSession('new'),
    ).toPromise();
    const typed = dispatched as { type: string; payload: unknown }[];
    expect(typed.find((a) => a.type === startNewSession.type)).toBeTruthy();
    expect(dispatched).toContainEqual(setHasSessions(true));
  });
});

type DispatchedAction = { type: string; payload: unknown };
type ScratchpadInputMutable = { id: string; raw_content: string; resolved_content: string };

describe('scratchpadSaga.buildMessagesToSubmit', () => {
  type SP = import('./scratchpadSlice').ScratchpadState;
  const baseState = (overrides: Partial<SP>): SP => ({
    currentSessionId: null,
    prevSessionId: null,
    nextSessionId: null,
    hasSessions: false,
    selectedPromptName: null,
    inputs: [],
    response: null,
    includeLastResponse: false,
    loading: 'idle',
    submitting: false,
    error: null,
    ...overrides,
  });

  it('produces a single aggregated user message when includeLastResponse is off', async () => {
    // Purpose: default scratchpad behavior (req:scratchpad-mode) is unchanged when the flag is off.
    const { buildMessagesToSubmit } = await import('./scratchpadSaga');
    const msgs = buildMessagesToSubmit(
      baseState({
        inputs: [
          { id: '1', raw_content: 'a', resolved_content: 'a' },
          { id: '2', raw_content: 'b', resolved_content: 'b' },
        ],
      }),
      null,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'a\n\nb' });
  });

  it('produces the 4-message multi-turn shape when flag on, prior usable, n>=2', async () => {
    // Purpose: req:scratchpad-include-last-response-shape — multi-turn with
    // [system?, user(earlier joined), assistant(last), user(new)].
    const { buildMessagesToSubmit } = await import('./scratchpadSaga');
    const msgs = buildMessagesToSubmit(
      baseState({
        includeLastResponse: true,
        inputs: [
          { id: '1', raw_content: 'old1', resolved_content: 'old1' },
          { id: '2', raw_content: 'old2', resolved_content: 'old2' },
          { id: '3', raw_content: 'new', resolved_content: 'new' },
        ],
        response: { content: 'prior!', model_name: 'm', is_stale: false, error: null },
      }),
      'SYS',
    );
    expect(msgs).toHaveLength(4);
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'SYS' });
    expect(msgs[1]).toMatchObject({ role: 'user', content: 'old1\n\nold2' });
    expect(msgs[2]).toMatchObject({ role: 'assistant', content: 'prior!' });
    expect(msgs[3]).toMatchObject({ role: 'user', content: 'new' });
  });

  it('falls back to single message when prior response is null', async () => {
    // Purpose: req:scratchpad-include-last-response-fallback — null prior response.
    const { buildMessagesToSubmit } = await import('./scratchpadSaga');
    const msgs = buildMessagesToSubmit(
      baseState({
        includeLastResponse: true,
        inputs: [
          { id: '1', raw_content: 'a', resolved_content: 'a' },
          { id: '2', raw_content: 'b', resolved_content: 'b' },
        ],
        response: null,
      }),
      null,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'a\n\nb' });
  });

  it('falls back to single message when prior response has an error', async () => {
    // Purpose: req:scratchpad-include-last-response-fallback — errored prior response.
    const { buildMessagesToSubmit } = await import('./scratchpadSaga');
    const { createAppError } = await import('@/types/errors');
    const msgs = buildMessagesToSubmit(
      baseState({
        includeLastResponse: true,
        inputs: [
          { id: '1', raw_content: 'a', resolved_content: 'a' },
          { id: '2', raw_content: 'b', resolved_content: 'b' },
        ],
        response: { content: 'x', model_name: 'm', is_stale: false, error: createAppError.unknown('boom') },
      }),
      null,
    );
    expect(msgs).toHaveLength(1);
  });

  it('falls back to single message when prior response content is empty', async () => {
    // Purpose: req:scratchpad-include-last-response-fallback — empty prior content is unusable.
    const { buildMessagesToSubmit } = await import('./scratchpadSaga');
    const msgs = buildMessagesToSubmit(
      baseState({
        includeLastResponse: true,
        inputs: [
          { id: '1', raw_content: 'a', resolved_content: 'a' },
          { id: '2', raw_content: 'b', resolved_content: 'b' },
        ],
        response: { content: '', model_name: 'm', is_stale: false, error: null },
      }),
      null,
    );
    expect(msgs).toHaveLength(1);
  });

  it('falls back to single message when only one input chunk exists', async () => {
    // Purpose: req:scratchpad-include-last-response-fallback — n<2 cannot be split.
    const { buildMessagesToSubmit } = await import('./scratchpadSaga');
    const msgs = buildMessagesToSubmit(
      baseState({
        includeLastResponse: true,
        inputs: [{ id: '1', raw_content: 'only', resolved_content: 'only' }],
        response: { content: 'prior', model_name: 'm', is_stale: false, error: null },
      }),
      null,
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'only' });
  });
});

describe('scratchpadSaga.sendWorker', () => {
  beforeEach(async () => {
    // Purpose: ensure a clean DB per test — reset modules and delete the DB so each test
    // starts with an empty scratchpad sessions store.
    try {
      const persistence = await import('@/services/persistence');
      const { closeDbForTesting } = persistence as typeof persistence & { closeDbForTesting?: () => Promise<void> };
      if (typeof closeDbForTesting === 'function') await closeDbForTesting();
    } catch { /* noop */ }
    vi.resetModules();
    const { deleteDB } = await import('idb');
    await deleteDB('tomatic_chat_db');
  });

  it('streams chunks and persists the new session (autosave)', async () => {
    // Purpose: req:scratchpad-auto-save-new + streaming — first send creates a session
    // and streams the response, dispatching sessionCreatedSuccess, responseChunk(s), and responseDone.
    const { sendRequested, responseChunk, responseDone, sessionCreatedSuccess } = await import('./scratchpadSlice');
    const { sendWorker } = await import('./scratchpadSaga');
    const dispatched: DispatchedAction[] = [];
    const inputs: ScratchpadInputMutable[] = [];
    const state = {
      scratchpad: {
        currentSessionId: null as string | null,
        prevSessionId: null,
        nextSessionId: null,
        inputs,
        response: null,
        selectedPromptName: null,
        includeLastResponse: false,
        hasSessions: false,
        loading: 'idle' as const,
        submitting: false,
        error: null,
      },
      settings: { apiKey: 'k', modelName: 'gpt-4', autoScrollEnabled: true, selectedPromptName: null, initialChatPrompt: null, loading: 'idle' as const, saving: 'idle' as const },
      prompts: { prompts: {}, loading: 'idle' as const, error: null },
      snippets: { snippets: [] },
    };

    // Dispatch interceptor simulates the Redux reducer so subsequent selects see updated state
    const dispatch = (a: DispatchedAction): void => {
      dispatched.push(a);
      if (a.type === 'scratchpad/appendInput') {
        const p = a.payload as { raw_content: string };
        inputs.push({ id: crypto.randomUUID(), raw_content: p.raw_content, resolved_content: '' });
      }
      if (a.type === 'scratchpad/setResolvedContent') {
        const p = a.payload as { inputId: string; resolved_content: string };
        const input = inputs.find((i) => i.id === p.inputId);
        if (input) input.resolved_content = p.resolved_content;
      }
      if (a.type === 'scratchpad/sessionCreatedSuccess') {
        const p = a.payload as { session: { session_id: string } };
        state.scratchpad.currentSessionId = p.session.session_id;
      }
    };

    await runSaga(
      {
        channel: stdChannel(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dispatch: dispatch as (action: unknown) => void,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getState: () => state as any,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendWorker as any,
      sendRequested({ raw_content: 'hello', modelName: 'gpt-4' }),
    ).toPromise();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain(sessionCreatedSuccess.type);
    expect(types.filter((t) => t === responseChunk.type).length).toBeGreaterThanOrEqual(1);
    expect(types).toContain(responseDone.type);
  });
});
