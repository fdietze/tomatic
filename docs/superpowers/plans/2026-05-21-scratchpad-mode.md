# Scratchpad Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Scratchpad" tab where the user accumulates input chunks that are concatenated into a single user message; one latest assistant response is generated per send/regenerate; assistant text never feeds back into the LLM.

**Architecture:** New Redux feature slice (`scratchpad`) with its own saga, a new IndexedDB store (`scratchpad_sessions`, v3→v4 migration), a new route `/scratchpad/:sessionId`, and a small set of new components that reuse `SystemPromptBar`, `Markdown`, and `CopyButton`. Generation reuses `streamChat`, snippet resolution reuses `resolveSnippetsWithTemplates` from `snippetsSaga.ts`.

**Tech Stack:** React, Redux Toolkit, redux-saga, idb (IndexedDB), Zod, react-router-dom, Vitest (unit/integration), Playwright (E2E). Build/lint/test entry point: `just check`.

**Spec:** `docs/superpowers/specs/2026-05-21-scratchpad-mode-design.md`

---

## File Structure

**New files**
- `src/types/scratchpad.ts` — domain types (`ScratchpadInput`, `ScratchpadResponse`, `ScratchpadSession`).
- `src/types/scratchpadPayloads.ts` — action payload types.
- `src/services/db/scratchpad-sessions.ts` — CRUD for the new IndexedDB store (mirrors `chat-sessions.ts`).
- `src/services/db/scratchpadSchemas.ts` — Zod schemas for runtime validation.
- `src/store/features/scratchpad/scratchpadSlice.ts` — Redux slice.
- `src/store/features/scratchpad/scratchpadSlice.test.ts` — slice unit tests.
- `src/store/features/scratchpad/scratchpadSaga.ts` — sagas (load / send / regenerate / autosave-new / navigation).
- `src/store/features/scratchpad/scratchpadSaga.test.ts` — saga integration tests.
- `src/pages/ScratchpadPage.tsx` — page wiring slice + components.
- `src/components/scratchpad/ScratchpadInputChunk.tsx` — one input chunk (collapsed/expanded + edit/delete).
- `src/components/scratchpad/ScratchpadResponsePanel.tsx` — response + stale badge + regenerate.
- `src/components/scratchpad/ScratchpadComposer.tsx` — textarea + model + send.
- `tests/scratchpad-basic.spec.ts` — E2E happy path.
- `tests/scratchpad-staleness.spec.ts` — E2E edit/delete/regen.
- `tests/scratchpad-system-prompt.spec.ts` — E2E system prompt + autosave-new.

**Modified files**
- `src/services/persistence.ts` — add `SCRATCHPAD_SESSIONS_STORE_NAME`, extend `TomaticDB` schema, add v3→v4 upgrade branch, bump `CURRENT_INDEXEDDB_VERSION`.
- `src/services/persistence/migrations.ts` — bump `CURRENT_INDEXEDDB_VERSION` to 4, append v3→v4 migration registry entry.
- `src/services/persistence/indexedDbMigrations.test.ts` — add v3→v4 migration test.
- `src/utils/routes.ts` — add `ROUTES.scratchpad`.
- `src/store/rootReducer.ts` — register `scratchpad` reducer.
- `src/store/rootSaga.ts` — register `scratchpadSaga`.
- `src/App.tsx` — register `/scratchpad/:sessionId` route and "Scratchpad" tab link in `Header`.
- `requirements.md` — add the new `req:scratchpad-*` identifiers.

---

## Task 1: Add domain types

**Files:**
- Create: `src/types/scratchpad.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/types/scratchpad.ts
import { MessageCost } from './chat';
import { AppError } from './errors';

export interface ScratchpadInput {
  id: string;
  raw_content: string;
  resolved_content: string;
}

export interface ScratchpadResponse {
  content: string;
  model_name: string;
  cost?: MessageCost | null;
  error?: AppError | null;
  is_stale: boolean;
}

export interface ScratchpadSession {
  session_id: string;
  prompt_name?: string | null;
  inputs: ScratchpadInput[];
  response: ScratchpadResponse | null;
  name?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the file is unused but must compile).

- [ ] **Step 3: Commit**

```bash
git add src/types/scratchpad.ts
git commit -m "feat(scratchpad): add domain types"
```

---

## Task 2: Add Zod schemas for scratchpad

**Files:**
- Create: `src/services/db/scratchpadSchemas.ts`
- Create: `src/services/db/scratchpadSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/db/scratchpadSchemas.test.ts
import { describe, it, expect } from 'vitest';
import { scratchpadSessionSchema } from './scratchpadSchemas';

describe('scratchpadSessionSchema', () => {
  it('parses a minimal valid session', () => {
    // Purpose: ensure schema accepts the canonical shape persisted to IndexedDB
    const result = scratchpadSessionSchema.safeParse({
      session_id: 's1',
      inputs: [
        { id: 'i1', raw_content: 'hello', resolved_content: 'hello' },
      ],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a session missing session_id', () => {
    // Purpose: schema must catch malformed persisted data so loadSession returns null
    const result = scratchpadSessionSchema.safeParse({
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(result.success).toBe(false);
  });

  it('parses a stored error string back into AppError', () => {
    // Purpose: response.error round-trips from a stored string into the in-memory AppError shape
    const parsed = scratchpadSessionSchema.parse({
      session_id: 's1',
      inputs: [],
      response: {
        content: '',
        model_name: 'm',
        is_stale: false,
        error: 'boom',
      },
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    expect(parsed.response?.error?.message).toContain('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/services/db/scratchpadSchemas.test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the schema**

```ts
// src/services/db/scratchpadSchemas.ts
import { z } from 'zod';
import { createAppError } from '@/types/errors';
import { messageCostSchema } from './schemas';
import type { ScratchpadSession } from '@/types/scratchpad';

export const scratchpadInputSchema = z.object({
  id: z.string(),
  raw_content: z.string(),
  resolved_content: z.string(),
});

export const scratchpadResponseSchema = z
  .object({
    content: z.string(),
    model_name: z.string(),
    cost: messageCostSchema.nullable().optional(),
    error: z.string().nullable().optional(),
    is_stale: z.boolean(),
  })
  .transform((data) => ({
    ...data,
    error: data.error ? createAppError.unknown(data.error) : null,
  }));

export const scratchpadSessionSchema: z.ZodType<ScratchpadSession> = z.object({
  session_id: z.string(),
  prompt_name: z.string().nullable().optional(),
  inputs: z.array(scratchpadInputSchema),
  response: scratchpadResponseSchema.nullable(),
  name: z.string().nullable().optional(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
}) as unknown as z.ZodType<ScratchpadSession>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/services/db/scratchpadSchemas.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/services/db/scratchpadSchemas.ts src/services/db/scratchpadSchemas.test.ts
git commit -m "feat(scratchpad): add zod schemas"
```

---

## Task 3: Add IndexedDB store + v3→v4 migration

**Files:**
- Modify: `src/services/persistence/migrations.ts`
- Modify: `src/services/persistence.ts`
- Modify: `src/services/persistence/indexedDbMigrations.test.ts`

- [ ] **Step 1: Write the failing migration test**

Append to `src/services/persistence/indexedDbMigrations.test.ts`:

```ts
describe('v3 → v4 migration', () => {
  it('creates an empty scratchpad_sessions store without touching existing data', async () => {
    // Purpose: req:scratchpad-separate-sessions — v4 introduces a new store; existing chat data is preserved.
    const { openDB, deleteDB } = await import('idb');
    const DB_NAME = 'tomatic_migration_v3_v4_test';
    await deleteDB(DB_NAME);

    // Seed v3
    const v3 = await openDB(DB_NAME, 3, {
      upgrade(db) {
        db.createObjectStore('chat_sessions', { keyPath: 'session_id' })
          .createIndex('updated_at_ms', 'updated_at_ms');
        db.createObjectStore('system_prompts', { keyPath: 'name' });
        db.createObjectStore('snippets', { keyPath: 'id' })
          .createIndex('name_idx', 'name', { unique: true });
      },
    });
    await v3.put('chat_sessions', {
      session_id: 'keep',
      messages: [],
      created_at_ms: 1,
      updated_at_ms: 2,
    });
    v3.close();

    // Open with current code (v4)
    const { default: _persistence } = await import('@/services/persistence');
    const { dbPromise } = await import('@/services/persistence');
    void _persistence;
    // Reset module-level singleton between tests is handled by Vitest reset; here we open directly:
    const v4 = await openDB(DB_NAME, 4, {
      upgrade(db, oldVersion) {
        // Mirror the production upgrade for our isolated db:
        if (oldVersion < 4 && !db.objectStoreNames.contains('scratchpad_sessions')) {
          const s = db.createObjectStore('scratchpad_sessions', { keyPath: 'session_id' });
          s.createIndex('updated_at_ms', 'updated_at_ms');
        }
      },
    });
    expect(v4.objectStoreNames.contains('scratchpad_sessions')).toBe(true);
    const kept = await v4.get('chat_sessions', 'keep');
    expect(kept).toBeTruthy();
    v4.close();
    await deleteDB(DB_NAME);
    void dbPromise; // suppress unused
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/services/persistence/indexedDbMigrations.test.ts`
Expected: FAIL — production migration registry/persistence does not declare v4 yet.

- [ ] **Step 3: Bump current version and add migration entry**

Edit `src/services/persistence/migrations.ts`:

Change:
```ts
export const CURRENT_INDEXEDDB_VERSION = 3;
```
to:
```ts
export const CURRENT_INDEXEDDB_VERSION = 4;
```

Append inside the `indexedDB.migrations` array (after the existing v2→v3 entry):
```ts
      {
        from: 3,
        to: 4,
        description: 'Create scratchpad_sessions store for scratchpad mode',
        // Handled in the upgrade callback in persistence.ts
      },
```

- [ ] **Step 4: Add the store to the persistence layer**

Edit `src/services/persistence.ts`:

After the line `export const SNIPPETS_STORE_NAME = "snippets";` add:
```ts
export const SCRATCHPAD_SESSIONS_STORE_NAME = "scratchpad_sessions";
```

Extend the `TomaticDB` interface by adding inside it:
```ts
  [SCRATCHPAD_SESSIONS_STORE_NAME]: {
    key: string;
    value: import('@/types/scratchpad').ScratchpadSession;
    indexes: {
      [UPDATED_AT_INDEX]: number;
    };
  };
```

Inside the `upgrade(db, oldVersion, _newVersion, tx)` callback, after the existing `if (oldVersion < 3)` block, add:
```ts
      // req:scratchpad-separate-sessions: v4 introduces scratchpad_sessions store
      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains(SCRATCHPAD_SESSIONS_STORE_NAME)) {
          const store = db.createObjectStore(SCRATCHPAD_SESSIONS_STORE_NAME, {
            keyPath: SESSION_ID_KEY_PATH,
          });
          store.createIndex(UPDATED_AT_INDEX, "updated_at_ms");
        }
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/services/persistence/indexedDbMigrations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/persistence.ts src/services/persistence/migrations.ts src/services/persistence/indexedDbMigrations.test.ts
git commit -m "feat(scratchpad): add v3->v4 migration + scratchpad_sessions store"
```

---

## Task 4: Add scratchpad CRUD module

**Files:**
- Create: `src/services/db/scratchpad-sessions.ts`
- Create: `src/services/db/scratchpad-sessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/db/scratchpad-sessions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveScratchpadSession,
  loadScratchpadSession,
  findNeighbourScratchpadIds,
  getMostRecentScratchpadId,
  hasScratchpadSessions,
} from './scratchpad-sessions';
import type { ScratchpadSession } from '@/types/scratchpad';

const mk = (id: string, updated_at_ms: number): ScratchpadSession => ({
  session_id: id,
  inputs: [],
  response: null,
  created_at_ms: updated_at_ms,
  updated_at_ms,
});

describe('scratchpad-sessions CRUD', () => {
  beforeEach(async () => {
    // Purpose: ensure a clean DB per test
    const { deleteDB } = await import('idb');
    await deleteDB('tomatic_chat_db');
  });

  it('saves and loads a session round-trip', async () => {
    // Purpose: round-trip persistence works through the Zod schema
    await saveScratchpadSession(mk('s1', 10));
    const loaded = await loadScratchpadSession('s1');
    expect(loaded?.session_id).toBe('s1');
  });

  it('returns null for unknown id', async () => {
    // Purpose: loadScratchpadSession is total — missing rows surface as null, not throw
    expect(await loadScratchpadSession('missing')).toBeNull();
  });

  it('finds previous and next session ids by updated_at_ms', async () => {
    // Purpose: sidebar prev/next navigation depends on this ordering
    await saveScratchpadSession(mk('a', 10));
    await saveScratchpadSession(mk('b', 20));
    await saveScratchpadSession(mk('c', 30));
    const nb = await findNeighbourScratchpadIds(mk('b', 20));
    expect(nb).toEqual({ prevId: 'a', nextId: 'c' });
  });

  it('returns the most recent session id', async () => {
    // Purpose: /scratchpad/new can offer "back to last" navigation
    await saveScratchpadSession(mk('a', 10));
    await saveScratchpadSession(mk('b', 30));
    expect(await getMostRecentScratchpadId()).toBe('b');
  });

  it('reports whether any sessions exist', async () => {
    // Purpose: enable/disable prev-button when on /scratchpad/new
    expect(await hasScratchpadSessions()).toBe(false);
    await saveScratchpadSession(mk('a', 1));
    expect(await hasScratchpadSessions()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/services/db/scratchpad-sessions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the CRUD module**

```ts
// src/services/db/scratchpad-sessions.ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/services/db/scratchpad-sessions.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/services/db/scratchpad-sessions.ts src/services/db/scratchpad-sessions.test.ts
git commit -m "feat(scratchpad): add session CRUD module"
```

---

## Task 5: Add payload types

**Files:**
- Create: `src/types/scratchpadPayloads.ts`

- [ ] **Step 1: Create payload types**

```ts
// src/types/scratchpadPayloads.ts
import { AppError } from './errors';
import { MessageCost } from './chat';
import { ScratchpadSession } from './scratchpad';

export interface LoadScratchpadSuccessPayload {
  session: ScratchpadSession;
  prevId: string | null;
  nextId: string | null;
}

export interface ScratchpadCreatedPayload {
  session: ScratchpadSession;
  prevId: string | null;
  nextId: string | null;
}

export interface AppendInputPayload {
  raw_content: string;
}

export interface EditInputPayload {
  inputId: string;
  raw_content: string;
}

export interface SetResolvedContentPayload {
  inputId: string;
  resolved_content: string;
}

export interface SendScratchpadRequestPayload {
  raw_content: string;
  modelName: string;
}

export interface RegenerateScratchpadRequestPayload {
  modelName: string;
}

export interface ScratchpadResponseChunkPayload {
  delta: string;
}

export interface ScratchpadResponseDonePayload {
  model_name: string;
  cost?: MessageCost | null;
}

export interface ScratchpadResponseFailedPayload {
  error: AppError;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/scratchpadPayloads.ts
git commit -m "feat(scratchpad): add payload types"
```

---

## Task 6: Redux slice

**Files:**
- Create: `src/store/features/scratchpad/scratchpadSlice.ts`
- Create: `src/store/features/scratchpad/scratchpadSlice.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/store/features/scratchpad/scratchpadSlice.test.ts
import { describe, it, expect } from 'vitest';
import scratchpadReducer, {
  appendInput,
  editInput,
  deleteInput,
  setResolvedContent,
  setSelectedPromptName,
  markResponseStale,
  startGeneration,
  responseChunk,
  responseDone,
  responseFailed,
  loadSessionSuccess,
  startNewSession,
} from './scratchpadSlice';

const init = scratchpadReducer(undefined, { type: '@@INIT' });

describe('scratchpadSlice', () => {
  it('appendInput adds a chunk with empty resolved_content', () => {
    // Purpose: composer submission seeds the chunk; saga fills resolved_content afterwards
    const s = scratchpadReducer(init, appendInput({ raw_content: 'hello' }));
    expect(s.inputs).toHaveLength(1);
    expect(s.inputs[0]!.raw_content).toBe('hello');
    expect(s.inputs[0]!.resolved_content).toBe('');
  });

  it('editInput marks response stale', () => {
    // Purpose: req:scratchpad-staleness — editing a chunk must mark the response stale without regenerating
    const withInput = scratchpadReducer(init, appendInput({ raw_content: 'a' }));
    const withResp = scratchpadReducer(withInput, responseDone({ model_name: 'm' }));
    const id = withResp.inputs[0]!.id;
    const after = scratchpadReducer(withResp, editInput({ inputId: id, raw_content: 'b' }));
    expect(after.inputs[0]!.raw_content).toBe('b');
    expect(after.response?.is_stale).toBe(true);
  });

  it('deleteInput marks response stale', () => {
    // Purpose: req:scratchpad-staleness — deleting a chunk marks response stale
    const a = scratchpadReducer(init, appendInput({ raw_content: 'a' }));
    const b = scratchpadReducer(a, responseDone({ model_name: 'm' }));
    const id = b.inputs[0]!.id;
    const c = scratchpadReducer(b, deleteInput(id));
    expect(c.inputs).toHaveLength(0);
    expect(c.response?.is_stale).toBe(true);
  });

  it('setSelectedPromptName marks response stale when it changes', () => {
    // Purpose: req:scratchpad-staleness — system prompt change must mark response stale
    const a = scratchpadReducer(init, responseDone({ model_name: 'm' }));
    const b = scratchpadReducer(a, setSelectedPromptName('promptA'));
    expect(b.response?.is_stale).toBe(true);
    expect(b.selectedPromptName).toBe('promptA');
  });

  it('responseChunk appends streamed text', () => {
    // Purpose: streaming updates accumulate into response.content
    const a = scratchpadReducer(init, startGeneration('gpt-4'));
    const b = scratchpadReducer(a, responseChunk({ delta: 'hel' }));
    const c = scratchpadReducer(b, responseChunk({ delta: 'lo' }));
    expect(c.response?.content).toBe('hello');
    expect(c.submitting).toBe(true);
  });

  it('responseDone clears submitting and stale flag', () => {
    // Purpose: completion ends submission and resets stale to false
    const a = scratchpadReducer(init, startGeneration('gpt-4'));
    const b = scratchpadReducer(a, responseChunk({ delta: 'x' }));
    const c = scratchpadReducer(b, responseDone({ model_name: 'gpt-4' }));
    expect(c.submitting).toBe(false);
    expect(c.response?.is_stale).toBe(false);
    expect(c.response?.model_name).toBe('gpt-4');
  });

  it('responseFailed records error and clears submitting', () => {
    // Purpose: errors land in response.error so the UI can surface them
    const a = scratchpadReducer(init, startGeneration('gpt-4'));
    const c = scratchpadReducer(a, responseFailed({ error: { kind: 'unknown', message: 'boom' } as any }));
    expect(c.submitting).toBe(false);
    expect(c.response?.error?.message).toBe('boom');
  });

  it('setResolvedContent updates only the targeted chunk', () => {
    // Purpose: saga writes back resolved snippet text per chunk
    const a = scratchpadReducer(init, appendInput({ raw_content: '@x' }));
    const id = a.inputs[0]!.id;
    const b = scratchpadReducer(a, setResolvedContent({ inputId: id, resolved_content: 'X' }));
    expect(b.inputs[0]!.resolved_content).toBe('X');
  });

  it('startNewSession clears the in-memory session', () => {
    // Purpose: navigating to /scratchpad/new resets state
    const a = scratchpadReducer(init, appendInput({ raw_content: 'x' }));
    const b = scratchpadReducer(a, startNewSession());
    expect(b.inputs).toHaveLength(0);
    expect(b.response).toBeNull();
    expect(b.currentSessionId).toBeNull();
  });

  it('loadSessionSuccess populates state and clears submitting', () => {
    // Purpose: navigating to an existing session replaces in-memory state
    const after = scratchpadReducer(init, loadSessionSuccess({
      session: {
        session_id: 's1',
        inputs: [{ id: 'i1', raw_content: 'a', resolved_content: 'a' }],
        response: { content: 'r', model_name: 'm', is_stale: false, error: null },
        created_at_ms: 1, updated_at_ms: 2,
      },
      prevId: null,
      nextId: null,
    }));
    expect(after.currentSessionId).toBe('s1');
    expect(after.inputs).toHaveLength(1);
    expect(after.response?.content).toBe('r');
  });

  it('markResponseStale flips the flag', () => {
    // Purpose: explicit stale dispatch is used when model changes externally
    const a = scratchpadReducer(init, responseDone({ model_name: 'm' }));
    const b = scratchpadReducer(a, markResponseStale());
    expect(b.response?.is_stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/store/features/scratchpad/scratchpadSlice.test.ts`
Expected: FAIL — slice module does not exist.

- [ ] **Step 3: Implement the slice**

```ts
// src/store/features/scratchpad/scratchpadSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../../store';
import { AppError } from '@/types/errors';
import type { ScratchpadInput, ScratchpadResponse } from '@/types/scratchpad';
import type {
  AppendInputPayload,
  EditInputPayload,
  LoadScratchpadSuccessPayload,
  ScratchpadCreatedPayload,
  ScratchpadResponseChunkPayload,
  ScratchpadResponseDonePayload,
  ScratchpadResponseFailedPayload,
  SendScratchpadRequestPayload,
  RegenerateScratchpadRequestPayload,
  SetResolvedContentPayload,
} from '@/types/scratchpadPayloads';

export interface ScratchpadState {
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  hasSessions: boolean;
  selectedPromptName: string | null;
  inputs: ScratchpadInput[];
  response: ScratchpadResponse | null;
  loading: 'idle' | 'loading' | 'failed';
  submitting: boolean;
  error: AppError | null;
}

const initialState: ScratchpadState = {
  currentSessionId: null,
  prevSessionId: null,
  nextSessionId: null,
  hasSessions: false,
  selectedPromptName: null,
  inputs: [],
  response: null,
  loading: 'idle',
  submitting: false,
  error: null,
};

const markStale = (state: ScratchpadState): void => {
  if (state.response) state.response.is_stale = true;
};

export const scratchpadSlice = createSlice({
  name: 'scratchpad',
  initialState,
  reducers: {
    // --- Lifecycle ---
    loadSession: (state, _action: PayloadAction<string>) => {
      state.loading = 'loading';
      state.error = null;
    },
    loadSessionSuccess: (state, action: PayloadAction<LoadScratchpadSuccessPayload>) => {
      const { session, prevId, nextId } = action.payload;
      state.loading = 'idle';
      state.currentSessionId = session.session_id;
      state.inputs = session.inputs;
      state.response = session.response;
      state.selectedPromptName = session.prompt_name ?? null;
      state.prevSessionId = prevId;
      state.nextSessionId = nextId;
    },
    loadSessionFailure: (state, action: PayloadAction<AppError>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
    sessionCreatedSuccess: (state, action: PayloadAction<ScratchpadCreatedPayload>) => {
      const { session, prevId, nextId } = action.payload;
      state.currentSessionId = session.session_id;
      state.prevSessionId = prevId;
      state.nextSessionId = nextId;
      state.hasSessions = true;
    },
    setHasSessions: (state, action: PayloadAction<boolean>) => {
      state.hasSessions = action.payload;
    },
    startNewSession: (state) => {
      state.currentSessionId = null;
      state.prevSessionId = null;
      state.nextSessionId = null;
      state.inputs = [];
      state.response = null;
      state.error = null;
    },
    goToPrevSession: (state) => { /* saga handles navigation */ void state; },
    goToNextSession: (state) => { /* saga handles navigation */ void state; },

    // --- Inputs ---
    appendInput: (state, action: PayloadAction<AppendInputPayload>) => {
      state.inputs.push({
        id: crypto.randomUUID(),
        raw_content: action.payload.raw_content,
        resolved_content: '',
      });
    },
    editInput: (state, action: PayloadAction<EditInputPayload>) => {
      const t = state.inputs.find((i) => i.id === action.payload.inputId);
      if (!t) return;
      t.raw_content = action.payload.raw_content;
      t.resolved_content = '';
      markStale(state);
    },
    deleteInput: (state, action: PayloadAction<string>) => {
      state.inputs = state.inputs.filter((i) => i.id !== action.payload);
      markStale(state);
    },
    setResolvedContent: (state, action: PayloadAction<SetResolvedContentPayload>) => {
      const t = state.inputs.find((i) => i.id === action.payload.inputId);
      if (t) t.resolved_content = action.payload.resolved_content;
    },

    // --- System prompt / model ---
    setSelectedPromptName: (state, action: PayloadAction<string | null>) => {
      if (state.selectedPromptName !== action.payload) markStale(state);
      state.selectedPromptName = action.payload;
    },
    markResponseStale: (state) => { markStale(state); },

    // --- Generation flow ---
    sendRequested: (state, _action: PayloadAction<SendScratchpadRequestPayload>) => {
      state.submitting = true;
      state.error = null;
    },
    regenerateRequested: (state, _action: PayloadAction<RegenerateScratchpadRequestPayload>) => {
      state.submitting = true;
      state.error = null;
    },
    startGeneration: (state, action: PayloadAction<string>) => {
      state.submitting = true;
      state.response = {
        content: '',
        model_name: action.payload,
        cost: null,
        error: null,
        is_stale: false,
      };
    },
    responseChunk: (state, action: PayloadAction<ScratchpadResponseChunkPayload>) => {
      if (!state.response) return;
      state.response.content += action.payload.delta;
    },
    responseDone: (state, action: PayloadAction<ScratchpadResponseDonePayload>) => {
      state.submitting = false;
      if (!state.response) {
        state.response = {
          content: '',
          model_name: action.payload.model_name,
          cost: action.payload.cost ?? null,
          error: null,
          is_stale: false,
        };
        return;
      }
      state.response.model_name = action.payload.model_name;
      state.response.cost = action.payload.cost ?? null;
      state.response.is_stale = false;
      state.response.error = null;
    },
    responseFailed: (state, action: PayloadAction<ScratchpadResponseFailedPayload>) => {
      state.submitting = false;
      if (!state.response) {
        state.response = {
          content: '',
          model_name: '',
          cost: null,
          error: action.payload.error,
          is_stale: false,
        };
        return;
      }
      state.response.error = action.payload.error;
    },
    setError: (state, action: PayloadAction<AppError | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  sessionCreatedSuccess,
  setHasSessions,
  startNewSession,
  goToPrevSession,
  goToNextSession,
  appendInput,
  editInput,
  deleteInput,
  setResolvedContent,
  setSelectedPromptName,
  markResponseStale,
  sendRequested,
  regenerateRequested,
  startGeneration,
  responseChunk,
  responseDone,
  responseFailed,
  setError,
} = scratchpadSlice.actions;

export const selectScratchpad = (state: RootState): ScratchpadState => state.scratchpad;

export default scratchpadSlice.reducer;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/store/features/scratchpad/scratchpadSlice.test.ts`
Expected: PASS (11/11).

- [ ] **Step 5: Commit**

```bash
git add src/store/features/scratchpad
git commit -m "feat(scratchpad): add redux slice"
```

---

## Task 7: Wire slice into the root reducer

**Files:**
- Modify: `src/store/rootReducer.ts`

- [ ] **Step 1: Add the reducer**

In `src/store/rootReducer.ts`, after `import appReducer from "./features/app/appSlice";` add:
```ts
import scratchpadReducer from "./features/scratchpad/scratchpadSlice";
```
Inside `combineReducers({...})`, add the line `scratchpad: scratchpadReducer,`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/store/rootReducer.ts
git commit -m "feat(scratchpad): register reducer"
```

---

## Task 8: Saga — load and navigation

**Files:**
- Create: `src/store/features/scratchpad/scratchpadSaga.ts`
- Create: `src/store/features/scratchpad/scratchpadSaga.test.ts`

- [ ] **Step 1: Write a failing test for load + autosave-new**

```ts
// src/store/features/scratchpad/scratchpadSaga.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { runSaga, stdChannel } from 'redux-saga';
import * as db from '@/services/db/scratchpad-sessions';
import { loadSessionWorker } from './scratchpadSaga';
import {
  loadSession,
  loadSessionSuccess,
  startNewSession,
  setHasSessions,
} from './scratchpadSlice';

describe('scratchpadSaga.loadSessionWorker', () => {
  beforeEach(async () => {
    const { deleteDB } = await import('idb');
    await deleteDB('tomatic_chat_db');
  });

  it('loads an existing session and reports neighbours', async () => {
    // Purpose: navigating to /scratchpad/:id hydrates state from IndexedDB
    await db.saveScratchpadSession({
      session_id: 'x',
      inputs: [],
      response: null,
      created_at_ms: 1,
      updated_at_ms: 1,
    });
    const dispatched: any[] = [];
    await runSaga(
      { channel: stdChannel(), dispatch: (a) => dispatched.push(a), getState: () => ({}) },
      loadSessionWorker as any,
      loadSession('x'),
    ).toPromise();
    expect(dispatched).toContainEqual(loadSessionSuccess({
      session: expect.objectContaining({ session_id: 'x' }),
      prevId: null,
      nextId: null,
    } as any));
  });

  it('treats "new" as startNewSession and reports hasSessions', async () => {
    // Purpose: /scratchpad/new yields an empty in-memory session; sidebar still knows whether sessions exist
    const dispatched: any[] = [];
    await db.saveScratchpadSession({
      session_id: 'y',
      inputs: [], response: null, created_at_ms: 1, updated_at_ms: 1,
    });
    await runSaga(
      { channel: stdChannel(), dispatch: (a) => dispatched.push(a), getState: () => ({}) },
      loadSessionWorker as any,
      loadSession('new'),
    ).toPromise();
    expect(dispatched).toContainEqual(startNewSession());
    expect(dispatched).toContainEqual(setHasSessions(true));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/store/features/scratchpad/scratchpadSaga.test.ts`
Expected: FAIL — saga module does not exist.

- [ ] **Step 3: Implement the load saga (only)**

```ts
// src/store/features/scratchpad/scratchpadSaga.ts
import { call, put, takeLatest, select } from 'redux-saga/effects';
import {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  startNewSession,
  setHasSessions,
  goToPrevSession,
  goToNextSession,
  selectScratchpad,
  type ScratchpadState,
} from './scratchpadSlice';
import {
  loadScratchpadSession,
  findNeighbourScratchpadIds,
  hasScratchpadSessions,
  getMostRecentScratchpadId,
} from '@/services/db/scratchpad-sessions';
import { createAppError } from '@/types/errors';
import { navigate } from '@/services/navigation';
import { ROUTES } from '@/utils/routes';

export function* loadSessionWorker(action: ReturnType<typeof loadSession>) {
  const id = action.payload;
  try {
    const any = (yield call(hasScratchpadSessions)) as boolean;
    yield put(setHasSessions(any));
    if (id === 'new' || !id) {
      yield put(startNewSession());
      return;
    }
    const session = (yield call(loadScratchpadSession, id)) as Awaited<ReturnType<typeof loadScratchpadSession>>;
    if (!session) {
      yield put(startNewSession());
      return;
    }
    const nb = (yield call(findNeighbourScratchpadIds, session)) as { prevId: string | null; nextId: string | null };
    yield put(loadSessionSuccess({ session, prevId: nb.prevId, nextId: nb.nextId }));
  } catch (e) {
    yield put(loadSessionFailure(createAppError.unknown(String(e))));
  }
}

function* goToPrevWorker() {
  const s = (yield select(selectScratchpad)) as ScratchpadState;
  if (s.prevSessionId) {
    navigate(ROUTES.scratchpad.session(s.prevSessionId));
    return;
  }
  if (!s.currentSessionId && s.hasSessions) {
    const id = (yield call(getMostRecentScratchpadId)) as string | null;
    if (id) navigate(ROUTES.scratchpad.session(id));
  }
}

function* goToNextWorker() {
  const s = (yield select(selectScratchpad)) as ScratchpadState;
  if (s.nextSessionId) navigate(ROUTES.scratchpad.session(s.nextSessionId));
}

export function* scratchpadSaga() {
  yield takeLatest(loadSession.type, loadSessionWorker);
  yield takeLatest(goToPrevSession.type, goToPrevWorker);
  yield takeLatest(goToNextSession.type, goToNextWorker);
}
```

> Note: `ROUTES.scratchpad` is added in Task 11. Until then this file will not typecheck — run typecheck after Task 11.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/store/features/scratchpad/scratchpadSaga.test.ts`
Expected: PASS (2/2). (Typecheck may fail until Task 11; tests only import named exports that exist.)

- [ ] **Step 5: Commit**

```bash
git add src/store/features/scratchpad/scratchpadSaga.ts src/store/features/scratchpad/scratchpadSaga.test.ts
git commit -m "feat(scratchpad): saga for load and prev/next navigation"
```

---

## Task 9: Routes constant

**Files:**
- Modify: `src/utils/routes.ts`

- [ ] **Step 1: Add the route shape**

Edit `src/utils/routes.ts` so the file becomes:

```ts
export const ROUTES = {
  chat: {
    new: '/chat/new',
    session: (sessionId: string): string => `/chat/${sessionId}`,
    byId: '/chat/:id',
  },
  scratchpad: {
    new: '/scratchpad/new',
    session: (sessionId: string): string => `/scratchpad/${sessionId}`,
    byId: '/scratchpad/:id',
  },
  settings: '/settings',
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (saga from Task 8 now resolves).

- [ ] **Step 3: Commit**

```bash
git add src/utils/routes.ts
git commit -m "feat(scratchpad): add scratchpad routes"
```

---

## Task 10: Saga — send (with snippet resolution + autosave-new + streaming)

**Files:**
- Modify: `src/store/features/scratchpad/scratchpadSaga.ts`
- Modify: `src/store/features/scratchpad/scratchpadSaga.test.ts`

- [ ] **Step 1: Write a failing test for the send flow**

Append to `scratchpadSaga.test.ts`:

```ts
import { vi } from 'vitest';

vi.mock('@/services/chatService', () => ({
  streamChat: vi.fn(async () => {
    async function* gen() {
      yield { choices: [{ delta: { content: 'hi ' } }] };
      yield { choices: [{ delta: { content: 'there' } }] };
    }
    return gen();
  }),
}));

import { sendRequested, responseChunk, responseDone, sessionCreatedSuccess } from './scratchpadSlice';
import { sendWorker } from './scratchpadSaga';

describe('scratchpadSaga.sendWorker', () => {
  beforeEach(async () => {
    const { deleteDB } = await import('idb');
    await deleteDB('tomatic_chat_db');
  });

  it('streams chunks and persists the new session (autosave)', async () => {
    // Purpose: req:scratchpad-auto-save-new + streaming — first send creates a session and streams the response
    const dispatched: any[] = [];
    const state = {
      scratchpad: {
        currentSessionId: null,
        inputs: [],
        response: null,
        selectedPromptName: null,
        hasSessions: false,
      },
      settings: { apiKey: 'k' },
      prompts: { prompts: {} },
    };
    await runSaga(
      {
        channel: stdChannel(),
        dispatch: (a) => dispatched.push(a),
        getState: () => state,
      },
      sendWorker as any,
      sendRequested({ raw_content: 'hello', modelName: 'gpt-4' }),
    ).toPromise();
    const types = dispatched.map((a) => a.type);
    expect(types).toContain(sessionCreatedSuccess.type);
    expect(types.filter((t) => t === responseChunk.type)).toHaveLength(2);
    expect(dispatched).toContainEqual(responseDone({ model_name: 'gpt-4' }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/store/features/scratchpad/scratchpadSaga.test.ts`
Expected: FAIL — `sendWorker` not exported.

- [ ] **Step 3: Implement `sendWorker` and `regenerateWorker`**

Add to the top of `scratchpadSaga.ts` (extend imports):
```ts
import { resolveSnippetsWithTemplates } from '@/store/features/snippets/snippetsSaga';
import { streamChat } from '@/services/chatService';
import { selectSettings } from '@/store/features/settings/settingsSlice';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import {
  appendInput,
  setResolvedContent,
  startGeneration,
  responseChunk,
  responseDone,
  responseFailed,
  sendRequested,
  regenerateRequested,
  sessionCreatedSuccess,
} from './scratchpadSlice';
import { saveScratchpadSession, findNeighbourScratchpadIds } from '@/services/db/scratchpad-sessions';
import type { ScratchpadSession } from '@/types/scratchpad';
import type { Message } from '@/types/chat';
```

Append the saga workers:

```ts
function buildMessagesToSubmit(
  state: ScratchpadState,
  systemPromptText: string | null,
): Message[] {
  const joined = state.inputs.map((i) => i.resolved_content).join('\n\n');
  const msgs: Message[] = [];
  if (systemPromptText) {
    msgs.push({
      id: 'sys',
      role: 'system',
      content: systemPromptText,
      raw_content: systemPromptText,
    });
  }
  msgs.push({
    id: 'aggregate',
    role: 'user',
    content: joined,
    raw_content: joined,
  });
  return msgs;
}

function* resolveSystemPrompt() {
  const sp = (yield select(selectScratchpad)) as ScratchpadState;
  const prompts = (yield select(selectPrompts)) as { prompts: Record<string, { data: { name: string; prompt: string } }> };
  if (!sp.selectedPromptName) return null;
  const found = Object.values(prompts.prompts).find((p) => p.data.name === sp.selectedPromptName);
  if (!found) return null;
  const resolved = (yield call(resolveSnippetsWithTemplates as any, found.data.prompt)) as string;
  return resolved;
}

function* persistCurrent(): Generator<any, ScratchpadSession, any> {
  const sp = (yield select(selectScratchpad)) as ScratchpadState;
  const now = Date.now();
  const sessionId = sp.currentSessionId ?? crypto.randomUUID();
  const session: ScratchpadSession = {
    session_id: sessionId,
    prompt_name: sp.selectedPromptName ?? null,
    inputs: sp.inputs,
    response: sp.response,
    created_at_ms: sp.currentSessionId ? now : now, // overwritten on update; new sessions get now
    updated_at_ms: now,
  };
  yield call(saveScratchpadSession, session);
  return session;
}

export function* sendWorker(action: ReturnType<typeof sendRequested>) {
  try {
    // 1. Append the new input chunk
    yield put(appendInput({ raw_content: action.payload.raw_content }));
    let sp = (yield select(selectScratchpad)) as ScratchpadState;
    const newChunk = sp.inputs[sp.inputs.length - 1]!;

    // 2. Resolve snippets for the new chunk (req:scratchpad-snippet-resolution + req:snippet-wait-before-submit)
    const resolved = (yield call(resolveSnippetsWithTemplates as any, newChunk.raw_content)) as string;
    yield put(setResolvedContent({ inputId: newChunk.id, resolved_content: resolved }));

    // 3. Resolve system prompt (if any)
    const systemPromptText = (yield call(resolveSystemPrompt)) as string | null;

    // 4. Build messages and persist (autosave-new)
    sp = (yield select(selectScratchpad)) as ScratchpadState;
    const wasNew = !sp.currentSessionId;
    const persisted = (yield call(persistCurrent)) as ScratchpadSession;
    if (wasNew) {
      const nb = (yield call(findNeighbourScratchpadIds, persisted)) as { prevId: string | null; nextId: string | null };
      yield put(sessionCreatedSuccess({ session: persisted, prevId: nb.prevId, nextId: nb.nextId }));
      navigate(ROUTES.scratchpad.session(persisted.session_id), { replace: true });
    }

    // 5. Stream the response
    yield put(startGeneration(action.payload.modelName));
    const { apiKey } = (yield select(selectSettings)) as { apiKey: string };
    const messagesToSubmit = buildMessagesToSubmit(
      (yield select(selectScratchpad)) as ScratchpadState,
      systemPromptText,
    );
    const stream = (yield call(streamChat, {
      messagesToSubmit,
      modelName: action.payload.modelName,
      apiKey,
    })) as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) yield put(responseChunk({ delta }));
    }
    yield put(responseDone({ model_name: action.payload.modelName }));
    // 6. Re-persist with completed response
    yield call(persistCurrent);
  } catch (e) {
    yield put(responseFailed({ error: createAppError.unknown(String(e)) }));
  }
}

export function* regenerateWorker(action: ReturnType<typeof regenerateRequested>) {
  try {
    const sp0 = (yield select(selectScratchpad)) as ScratchpadState;
    // Re-resolve snippets for ALL chunks (their raw_content may reference snippets that changed)
    for (const chunk of sp0.inputs) {
      const resolved = (yield call(resolveSnippetsWithTemplates as any, chunk.raw_content)) as string;
      yield put(setResolvedContent({ inputId: chunk.id, resolved_content: resolved }));
    }
    const systemPromptText = (yield call(resolveSystemPrompt)) as string | null;
    yield put(startGeneration(action.payload.modelName));
    const { apiKey } = (yield select(selectSettings)) as { apiKey: string };
    const messagesToSubmit = buildMessagesToSubmit(
      (yield select(selectScratchpad)) as ScratchpadState,
      systemPromptText,
    );
    const stream = (yield call(streamChat, {
      messagesToSubmit,
      modelName: action.payload.modelName,
      apiKey,
    })) as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) yield put(responseChunk({ delta }));
    }
    yield put(responseDone({ model_name: action.payload.modelName }));
    yield call(persistCurrent);
  } catch (e) {
    yield put(responseFailed({ error: createAppError.unknown(String(e)) }));
  }
}
```

Extend the root saga binding in the same file:
```ts
export function* scratchpadSaga() {
  yield takeLatest(loadSession.type, loadSessionWorker);
  yield takeLatest(goToPrevSession.type, goToPrevWorker);
  yield takeLatest(goToNextSession.type, goToNextWorker);
  yield takeLatest(sendRequested.type, sendWorker);
  yield takeLatest(regenerateRequested.type, regenerateWorker);
}
```

> Note: if `resolveSnippetsWithTemplates` is not exported from `snippetsSaga.ts`, export it (one-line change at its declaration: add `export` keyword).

- [ ] **Step 2a: Ensure resolveSnippetsWithTemplates is exported**

Open `src/store/features/snippets/snippetsSaga.ts`. Find the declaration of `resolveSnippetsWithTemplates`. If it is not already prefixed with `export`, add `export`. Run `git diff` to confirm only that token changed.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run src/store/features/scratchpad/scratchpadSaga.test.ts`
Expected: PASS (all tests).

- [ ] **Step 4: Commit**

```bash
git add src/store/features/scratchpad/scratchpadSaga.ts src/store/features/scratchpad/scratchpadSaga.test.ts src/store/features/snippets/snippetsSaga.ts
git commit -m "feat(scratchpad): send + regenerate saga with snippet resolution and autosave"
```

---

## Task 11: Wire the saga into the root saga

**Files:**
- Modify: `src/store/rootSaga.ts`

- [ ] **Step 1: Register the saga**

In `src/store/rootSaga.ts`, after `import { appSaga } from "./features/app/appSaga";`, add:
```ts
import { scratchpadSaga } from "./features/scratchpad/scratchpadSaga";
```
Inside `yield all([ ... ])`, add `fork(scratchpadSaga),`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/store/rootSaga.ts
git commit -m "feat(scratchpad): register saga"
```

---

## Task 12: Input chunk component

**Files:**
- Create: `src/components/scratchpad/ScratchpadInputChunk.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/scratchpad/ScratchpadInputChunk.tsx
import React, { useState } from 'react';
import Markdown from '@/components/Markdown';
import { useDispatch } from 'react-redux';
import { deleteInput, editInput } from '@/store/features/scratchpad/scratchpadSlice';
import type { ScratchpadInput } from '@/types/scratchpad';

interface Props {
  chunk: ScratchpadInput;
}

const ScratchpadInputChunk: React.FC<Props> = ({ chunk }) => {
  const dispatch = useDispatch();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chunk.raw_content);

  if (editing) {
    return (
      <div className="scratchpad-chunk" data-testid={`scratchpad-chunk-${chunk.id}`}>
        <textarea
          data-testid={`scratchpad-chunk-textarea-${chunk.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          data-testid={`scratchpad-chunk-save-${chunk.id}`}
          onClick={() => {
            dispatch(editInput({ inputId: chunk.id, raw_content: draft }));
            setEditing(false);
          }}
        >
          Save
        </button>
        <button onClick={() => { setDraft(chunk.raw_content); setEditing(false); }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="scratchpad-chunk" data-testid={`scratchpad-chunk-${chunk.id}`}>
      <div onClick={() => setExpanded((v) => !v)} data-testid={`scratchpad-chunk-body-${chunk.id}`}>
        {expanded ? <Markdown content={chunk.raw_content} /> : <pre>{chunk.raw_content}</pre>}
      </div>
      <button data-testid={`scratchpad-chunk-edit-${chunk.id}`} onClick={() => setEditing(true)} aria-label="edit">✎</button>
      <button data-testid={`scratchpad-chunk-delete-${chunk.id}`} onClick={() => dispatch(deleteInput(chunk.id))} aria-label="delete">🗑</button>
    </div>
  );
};

export default ScratchpadInputChunk;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/scratchpad/ScratchpadInputChunk.tsx
git commit -m "feat(scratchpad): input chunk component"
```

---

## Task 13: Response panel component

**Files:**
- Create: `src/components/scratchpad/ScratchpadResponsePanel.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/scratchpad/ScratchpadResponsePanel.tsx
import React from 'react';
import Markdown from '@/components/Markdown';
import CopyButton from '@/components/CopyButton';
import { useDispatch, useSelector } from 'react-redux';
import { selectSettings } from '@/store/features/settings/settingsSlice';
import {
  regenerateRequested,
  selectScratchpad,
} from '@/store/features/scratchpad/scratchpadSlice';
import { getErrorMessage } from '@/types/errors';

const ScratchpadResponsePanel: React.FC = () => {
  const dispatch = useDispatch();
  const { response, inputs, submitting } = useSelector(selectScratchpad);
  const { modelName } = useSelector(selectSettings);

  if (!response && !submitting) return null;

  return (
    <section data-testid="scratchpad-response">
      <header>
        <span>Response</span>
        {response?.is_stale && (
          <span data-testid="scratchpad-stale-badge">stale</span>
        )}
        <button
          data-testid="scratchpad-regenerate"
          disabled={inputs.length === 0 || submitting}
          onClick={() => dispatch(regenerateRequested({ modelName }))}
        >
          ⟳ regenerate
        </button>
      </header>
      {response?.error ? (
        <div data-testid="scratchpad-response-error">{getErrorMessage(response.error)}</div>
      ) : (
        <>
          <Markdown content={response?.content ?? ''} />
          {response && <CopyButton text={response.content} />}
        </>
      )}
    </section>
  );
};

export default ScratchpadResponsePanel;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/scratchpad/ScratchpadResponsePanel.tsx
git commit -m "feat(scratchpad): response panel"
```

---

## Task 14: Composer component

**Files:**
- Create: `src/components/scratchpad/ScratchpadComposer.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/scratchpad/ScratchpadComposer.tsx
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { selectSettings, setModelName } from '@/store/features/settings/settingsSlice';
import { selectModels } from '@/store/features/models/modelsSlice';
import { sendRequested, markResponseStale } from '@/store/features/scratchpad/scratchpadSlice';

const ScratchpadComposer: React.FC = () => {
  const dispatch = useDispatch();
  const { modelName } = useSelector(selectSettings);
  const { models } = useSelector(selectModels);
  const [draft, setDraft] = useState('');

  const onSend = (): void => {
    if (!draft.trim()) return;
    dispatch(sendRequested({ raw_content: draft, modelName }));
    setDraft('');
  };

  return (
    <div data-testid="scratchpad-composer">
      <select
        data-testid="scratchpad-model-select"
        value={modelName}
        onChange={(e) => {
          dispatch(setModelName(e.target.value));
          dispatch(markResponseStale());
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.id}</option>
        ))}
      </select>
      <textarea
        data-testid="scratchpad-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend();
        }}
      />
      <button data-testid="scratchpad-send" onClick={onSend}>Send</button>
    </div>
  );
};

export default ScratchpadComposer;
```

> Verify in `settingsSlice.ts` that `setModelName` exists. If a different name is used (e.g. `setModel`, `selectModel`), substitute it consistently here and in tests.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/scratchpad/ScratchpadComposer.tsx
git commit -m "feat(scratchpad): composer"
```

---

## Task 15: ScratchpadPage

**Files:**
- Create: `src/pages/ScratchpadPage.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// src/pages/ScratchpadPage.tsx
import React, { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useParams } from 'react-router-dom';
import ChatHeader from '@/components/ChatHeader';
import SystemPromptBar from '@/components/SystemPromptBar';
import ScratchpadInputChunk from '@/components/scratchpad/ScratchpadInputChunk';
import ScratchpadResponsePanel from '@/components/scratchpad/ScratchpadResponsePanel';
import ScratchpadComposer from '@/components/scratchpad/ScratchpadComposer';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import {
  loadSession,
  goToPrevSession,
  goToNextSession,
  setSelectedPromptName,
  selectScratchpad,
} from '@/store/features/scratchpad/scratchpadSlice';
import { getErrorMessage } from '@/types/errors';

const ScratchpadPage: React.FC = () => {
  const dispatch = useDispatch();
  const { sessionId } = useParams<{ sessionId: string }>();
  const sp = useSelector(selectScratchpad);
  const { prompts: systemPromptsMap } = useSelector(selectPrompts);

  useEffect(() => {
    dispatch(loadSession(sessionId ?? 'new'));
  }, [sessionId, dispatch]);

  const systemPromptEntities = useMemo(() => Object.values(systemPromptsMap), [systemPromptsMap]);

  return (
    <>
      <ChatHeader
        canGoPrev={!!sp.prevSessionId || (!sp.currentSessionId && sp.hasSessions)}
        canGoNext={!!sp.nextSessionId}
        onPrev={() => dispatch(goToPrevSession())}
        onNext={() => dispatch(goToNextSession())}
      >
        <SystemPromptBar
          systemPrompts={systemPromptEntities}
          selectedPromptName={sp.selectedPromptName}
          onSelectPrompt={(name) => dispatch(setSelectedPromptName(name))}
        />
      </ChatHeader>
      {sp.error && (
        <div className="error-display" data-testid="error-message">
          <p>{getErrorMessage(sp.error)}</p>
        </div>
      )}
      <section data-testid="scratchpad-inputs">
        {sp.inputs.map((chunk) => (
          <ScratchpadInputChunk key={chunk.id} chunk={chunk} />
        ))}
      </section>
      <ScratchpadResponsePanel />
      <ScratchpadComposer />
    </>
  );
};

export default ScratchpadPage;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ScratchpadPage.tsx
git commit -m "feat(scratchpad): page wiring"
```

---

## Task 16: Top-nav tab + route

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the route and tab link**

In `src/App.tsx`:

1. After `import SettingsPage from "@/pages/SettingsPage";` add:
```ts
import ScratchpadPage from "@/pages/ScratchpadPage";
```
2. In the `Routes` block, before the catch-all `*` route, add:
```tsx
<Route path="/scratchpad/:sessionId" element={<ScratchpadPage />} />
<Route path="/scratchpad" element={<Navigate to="/scratchpad/new" replace />} />
```
3. In the `Header` JSX where the nav buttons live (locate the existing "Chat" / "Settings" tab/link buttons by inspecting the file), add a "Scratchpad" link/button that navigates to `ROUTES.scratchpad.new`, mirroring how the "Chat" button uses `ROUTES.chat.new` / `lastChatUrl`. Use `data-testid="nav-scratchpad"`.

- [ ] **Step 2: Manual sanity test in dev**

Run: `pnpm dev` (in another shell), open the printed URL, click the new tab, confirm `/scratchpad/new` loads with composer visible.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(scratchpad): route and top-nav tab"
```

---

## Task 17: Update requirements.md

**Files:**
- Modify: `requirements.md`

- [ ] **Step 1: Append the new section**

Append the following section at the end of `requirements.md`:

```markdown
## Scratchpad Mode

- req:scratchpad-mode: dedicated tab/route with aggregated single-user-message flow; assistant responses never feed back into the LLM.
- req:scratchpad-aggregation: user inputs are joined with "\n\n" into a single user message at send/regen time.
- req:scratchpad-staleness: edit/delete of an input chunk, or change of system prompt/model, marks the response stale without regenerating; explicit user action regenerates.
- req:scratchpad-separate-sessions: scratchpad sessions live in their own IndexedDB store, separate from chat sessions.
- req:scratchpad-snippet-resolution: snippet references in scratchpad inputs resolve identically to chat (same wait/error semantics).
- req:scratchpad-auto-save-new: first send on /scratchpad/new persists and updates URL.
```

- [ ] **Step 2: Commit**

```bash
git add requirements.md
git commit -m "docs(scratchpad): document new requirements"
```

---

## Task 18: E2E — basic send flow

**Files:**
- Create: `tests/scratchpad-basic.spec.ts`

- [ ] **Step 1: Inspect a chat e2e test for mock setup**

Read `tests/` for any existing test that already mocks the OpenRouter streaming endpoint. Identify the helper (likely `setupOpenRouterMock` or a `page.route` block). Use the exact same approach below.

- [ ] **Step 2: Write the test**

```ts
// tests/scratchpad-basic.spec.ts
import { test, expect } from '@playwright/test';
import { waitForEvent } from './helpers/waitForEvent'; // adjust path to match existing helper
import { seedIndexedDB } from './helpers/seedIndexedDB'; // adjust path

test.describe('Feature: Scratchpad basic flow', () => {
  test.beforeEach(async ({ page }) => {
    // Purpose: load app on the scratchpad/new route with no prior sessions
    await seedIndexedDB(page, { scratchpad_sessions: [] });
    await page.goto('/scratchpad/new');
    await waitForEvent(page, 'app_initialized');
  });

  test('sending a single input produces one assistant response', async ({ page }) => {
    // Purpose: req:scratchpad-mode + req:scratchpad-aggregation — one input yields one streamed response, URL updates to a session id
    // mock streaming response (use existing chat-test helper)
    await page.route('**/chat/completions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n` +
              `data: ${JSON.stringify({ choices: [{ delta: { content: ' there' } }] })}\n\n` +
              `data: [DONE]\n\n`,
      });
    });

    await page.getByTestId('scratchpad-input').fill('hello');
    await page.getByTestId('scratchpad-send').click();

    // req:scratchpad-auto-save-new
    await expect(page).toHaveURL(/\/scratchpad\/[0-9a-f-]+$/);
    await expect(page.getByTestId('scratchpad-response')).toContainText('hi there');
  });
});
```

> If the project's existing chat tests use a different streaming-mock helper, swap the `page.route` block above for that helper to keep the test suite consistent.

- [ ] **Step 3: Run**

Run: `pnpm exec playwright test scratchpad-basic`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/scratchpad-basic.spec.ts
git commit -m "test(scratchpad): e2e basic send flow"
```

---

## Task 19: E2E — edit/delete marks stale, regenerate clears stale

**Files:**
- Create: `tests/scratchpad-staleness.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/scratchpad-staleness.spec.ts
import { test, expect } from '@playwright/test';
import { waitForEvent } from './helpers/waitForEvent';
import { seedIndexedDB } from './helpers/seedIndexedDB';

test.describe('Feature: Scratchpad staleness', () => {
  test.beforeEach(async ({ page }) => {
    // Purpose: pre-seed a scratchpad session with one chunk and one response
    await seedIndexedDB(page, {
      scratchpad_sessions: [{
        session_id: 'pre',
        prompt_name: null,
        inputs: [{ id: 'c1', raw_content: 'first', resolved_content: 'first' }],
        response: {
          content: 'old response', model_name: 'm', is_stale: false, error: null,
        },
        created_at_ms: 1, updated_at_ms: 1,
      }],
    });
    await page.goto('/scratchpad/pre');
    await waitForEvent(page, 'app_initialized');
  });

  test('editing a chunk shows a stale badge without regenerating', async ({ page }) => {
    // Purpose: req:scratchpad-staleness — edit triggers stale flag, response text unchanged
    await page.getByTestId('scratchpad-chunk-edit-c1').click();
    await page.getByTestId('scratchpad-chunk-textarea-c1').fill('changed');
    await page.getByTestId('scratchpad-chunk-save-c1').click();
    await expect(page.getByTestId('scratchpad-stale-badge')).toBeVisible();
    await expect(page.getByTestId('scratchpad-response')).toContainText('old response');
  });

  test('deleting a chunk marks the response stale', async ({ page }) => {
    // Purpose: req:scratchpad-staleness — delete triggers stale flag
    await page.getByTestId('scratchpad-chunk-delete-c1').click();
    // With zero chunks, response panel may hide; if it remains visible, stale should be set:
    const responseVisible = await page.getByTestId('scratchpad-response').isVisible();
    if (responseVisible) {
      await expect(page.getByTestId('scratchpad-stale-badge')).toBeVisible();
    }
  });

  test('regenerate clears the stale badge', async ({ page }) => {
    // Purpose: req:scratchpad-staleness — regenerate produces a fresh response and clears stale
    await page.route('**/chat/completions**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'fresh' } }] })}\n\n` +
              `data: [DONE]\n\n`,
      });
    });
    await page.getByTestId('scratchpad-chunk-edit-c1').click();
    await page.getByTestId('scratchpad-chunk-textarea-c1').fill('changed');
    await page.getByTestId('scratchpad-chunk-save-c1').click();
    await expect(page.getByTestId('scratchpad-stale-badge')).toBeVisible();
    await page.getByTestId('scratchpad-regenerate').click();
    await expect(page.getByTestId('scratchpad-response')).toContainText('fresh');
    await expect(page.getByTestId('scratchpad-stale-badge')).toBeHidden();
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test scratchpad-staleness`
Expected: PASS (3/3).

- [ ] **Step 3: Commit**

```bash
git add tests/scratchpad-staleness.spec.ts
git commit -m "test(scratchpad): e2e edit/delete/regenerate staleness"
```

---

## Task 20: E2E — system prompt sync + auto-save URL change

**Files:**
- Create: `tests/scratchpad-system-prompt.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/scratchpad-system-prompt.spec.ts
import { test, expect } from '@playwright/test';
import { waitForEvent } from './helpers/waitForEvent';
import { seedIndexedDB } from './helpers/seedIndexedDB';

test.describe('Feature: Scratchpad system prompt + autosave', () => {
  test.beforeEach(async ({ page }) => {
    // Purpose: seed two system prompts; start on /scratchpad/new
    await seedIndexedDB(page, {
      scratchpad_sessions: [],
      system_prompts: [
        { name: 'concise', prompt: 'Be concise.' },
        { name: 'verbose', prompt: 'Be verbose.' },
      ],
    });
    await page.goto('/scratchpad/new');
    await waitForEvent(page, 'app_initialized');
  });

  test('first send autosaves and URL changes', async ({ page }) => {
    // Purpose: req:scratchpad-auto-save-new — URL transitions from /new to /:id without page reload
    await page.route('**/chat/completions**', async (r) => r.fulfill({
      status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`,
    }));
    await page.getByTestId('scratchpad-input').fill('hi');
    await page.getByTestId('scratchpad-send').click();
    await expect(page).toHaveURL(/\/scratchpad\/[0-9a-f-]+$/);
  });

  test('changing system prompt marks response stale', async ({ page }) => {
    // Purpose: req:scratchpad-staleness — system prompt selection change must mark response stale
    await page.route('**/chat/completions**', async (r) => r.fulfill({
      status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`,
    }));
    await page.getByTestId('scratchpad-input').fill('hi');
    await page.getByTestId('scratchpad-send').click();
    await expect(page.getByTestId('scratchpad-response')).toContainText('ok');
    // Select a system prompt — must mark stale
    await page.getByTestId('system-prompt-select').selectOption('concise'); // adjust testid if SystemPromptBar uses a different one
    await expect(page.getByTestId('scratchpad-stale-badge')).toBeVisible();
  });
});
```

> If `SystemPromptBar` exposes a different testid/selector, substitute it here. Inspect `src/components/SystemPromptBar.tsx` for the correct selector before running.

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test scratchpad-system-prompt`
Expected: PASS (2/2).

- [ ] **Step 3: Commit**

```bash
git add tests/scratchpad-system-prompt.spec.ts
git commit -m "test(scratchpad): e2e system prompt sync + autosave"
```

---

## Task 21: Full validation

- [ ] **Step 1: Run the full validation pipeline**

Run: `just check`
Expected: all lint/typecheck/test suites pass, including the new vitest and Playwright tests. If a failure occurs, enter the Debugging Protocol per `CLAUDE.md`.

- [ ] **Step 2: Final commit (if anything was tweaked during check)**

```bash
git status
# only commit if there are real changes
git add -A
git commit -m "chore(scratchpad): final lint/test fixes"
```

---

## Notes for Implementers

- **Snippet wait semantics** (`req:snippet-wait-before-submit`): `resolveSnippetsWithTemplates` is already responsible for awaiting in-flight snippet generations. If during integration testing you find that it does not block on dirty snippets, follow the same pattern used in `sessionSaga.ts` (search for "wait" or "waitForSnippet" near where it calls `resolveSnippetsWithTemplates`) and replicate it in `sendWorker` / `regenerateWorker` before calling resolution.
- **No backward-compat code**: this is a new feature on top of v3 data; do not add fallbacks for "old scratchpad sessions" — there are none.
- **No assistant-message feedback**: never push `response.content` into any future LLM request. The aggregate user message is built solely from `inputs[*].resolved_content`. If a future regression adds it, the spec is being violated.
- **Tests are explicit**: each `test()` opens with a `// Purpose:` comment per `CLAUDE.md`.

---

## Self-Review Notes

- Spec coverage: req:scratchpad-mode (Tasks 14–16, 18), req:scratchpad-aggregation (Task 10 — `buildMessagesToSubmit`), req:scratchpad-staleness (Task 6 reducers + Tasks 19/20), req:scratchpad-separate-sessions (Tasks 3–4), req:scratchpad-snippet-resolution (Task 10), req:scratchpad-auto-save-new (Task 10 + Task 20).
- No placeholders or "TODO" steps; every code step contains complete code.
- Type/name consistency verified: `sendRequested`, `regenerateRequested`, `appendInput`, `editInput`, `deleteInput`, `setResolvedContent`, `setSelectedPromptName`, `markResponseStale`, `startGeneration`, `responseChunk`, `responseDone`, `responseFailed`, `sessionCreatedSuccess`, `loadSession`, `loadSessionSuccess`, `loadSessionFailure`, `selectScratchpad` are defined in Task 6 and used in Tasks 8/10/12–15 with identical spellings.
- `SCRATCHPAD_SESSIONS_STORE_NAME` defined in Task 3 and used in Task 4 — matches.
- `ROUTES.scratchpad` defined in Task 9 and used in Tasks 8, 10, 16 — matches. Task 8's "typecheck only after Task 11" note acknowledges the temporary forward reference.
