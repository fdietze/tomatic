# Scratchpad: Optional "include last response" context

**Status:** Design approved, ready for implementation plan
**Date:** 2026-05-22

## Goal

Let the user opt a scratchpad session into feeding its last assistant response back as a real `assistant` turn on the next send / regenerate. This unlocks iterative refinement of a text artifact (where the model treats its prior output as canonical and applies the new instruction as a diff) while keeping the default scratchpad behavior — single aggregated user message, assistant output never fed back — unchanged.

## Background

The current scratchpad (`req:scratchpad-mode`) always joins all input chunks with `\n\n` into a single `user` message and sends `[system?, user(joined)]`. Assistant responses never re-enter the LLM. This is good for divergent attempts but weak for iterative refinement of a text artifact, because instruction-tuned models are post-trained on multi-turn dialogues where the assistant role contains its own prior output.

## Conversation shape

Per-session checkbox `include_last_response`.

**When unchecked (default, unchanged):**
```
[system?, user(all inputs joined with "\n\n")]
```

**When checked and a usable prior response exists:**
```
[system?,
 user(inputs[0..n-2] joined with "\n\n"),
 assistant(response.content),
 user(inputs[n-1])]
```

- "Usable prior response" = `response != null && response.error == null && response.content.length > 0`.
- `n` is the total number of input chunks at submission time. On **send**, the just-typed composer text has already been appended via `appendInput` and is `inputs[n-1]`. On **regenerate**, the existing last chunk is `inputs[n-1]`. Send and regenerate therefore converge on the same builder.

**When checked but no usable prior response, or only one input chunk exists:** silent fallback to the unchecked shape. The checkbox stays checked for next time. No warning, no error.

Note on "chunks added since last response": any chunks added to the session after the last response (but not yet sent) are folded into the first `user` turn alongside earlier chunks. The data model has a flat input list; there is no per-input "existed at response time" tracking. This is a deliberate simplification.

## Data model

Add to `ScratchpadSession` (`src/types/scratchpad.ts`):

```ts
export interface ScratchpadSession {
  // ...existing fields...
  include_last_response: boolean;
}
```

Default for new sessions: `false`.

## Persistence — IndexedDB migration v4 → v5

- Bump the scratchpad sessions store schema version from 4 to 5.
- Migration: existing rows get `include_last_response: false`.
- Add a v5 JSON fixture per `req:migration-test-fixtures`.
- Update `src/services/db/scratchpadSchemas.ts`, `scratchpad-sessions.ts`, and the seeding helper used by e2e tests (currently bumped from v3 to v4 in commit `3a598ce`) to support v5.
- Migration unit tests cover v4 → v5 and confirm the new field is present and defaulted.

## Redux state & actions

Add to `ScratchpadState` (`scratchpadSlice.ts`):

```ts
includeLastResponse: boolean;
```

New action: `setIncludeLastResponse(value: boolean)`.

Reducer behavior for `setIncludeLastResponse`:
1. Set `state.includeLastResponse = value`.
2. If `state.response` is non-null, set `state.response.is_stale = true` (same staleness pattern as model/prompt change, per `req:scratchpad-staleness`).
3. Persistence is handled via the existing autosave flow (no special-casing).

`loadSession` / `persistCurrent` round-trip the new field.

## Saga changes

Replace `buildMessagesToSubmit` with a builder that branches on `(state.includeLastResponse, usable prior response, inputs.length >= 2)`:

```ts
function buildMessagesToSubmit(state: ScratchpadState, systemPromptText: string | null): Message[] {
  const hasUsablePrior =
    state.response != null &&
    state.response.error == null &&
    state.response.content.length > 0;
  const canSplit = state.inputs.length >= 2;

  if (state.includeLastResponse && hasUsablePrior && canSplit) {
    return buildMultiTurn(state, systemPromptText);
  }
  return buildSingleTurn(state, systemPromptText);  // current behavior
}
```

Both `sendWorker` and `regenerateWorker` call the same builder unchanged elsewhere. Streaming, persistence, and error handling are unaffected.

## UI

In the scratchpad header area (alongside model picker and system prompt selector), add a labeled checkbox:

- Label: "Include last response in context"
- Stable `data-testid`: `scratchpad-include-last-response`
- Always enabled (no disabled state); silent fallback handles missing-prior cases.
- onChange dispatches `setIncludeLastResponse(newValue)`.

No new control in the composer or response panel.

## Requirements (to add to `requirements.md` under "Scratchpad Mode")

- `req:scratchpad-include-last-response`: per-session opt-in to feed the last assistant response back as a real `assistant` turn between existing inputs and the new input.
- `req:scratchpad-include-last-response-shape`: when enabled and a usable prior response exists, the request is `[system?, user(inputs[0..n-2] joined with "\n\n"), assistant(response.content), user(inputs[n-1])]`.
- `req:scratchpad-include-last-response-fallback`: when enabled but no usable prior response exists (null / errored / empty content) or fewer than 2 input chunks exist, fall back silently to the single-aggregated-user-message shape.
- `req:scratchpad-include-last-response-stale`: toggling the checkbox marks the current response stale without regenerating.
- `req:scratchpad-include-last-response-persisted`: the setting is stored per-session in IndexedDB (v5) and survives reload and session switch.

Update note on `req:scratchpad-mode`: the "assistant responses never feed back into the LLM" rule has this single opt-in exception.

## Test plan

**Unit — saga / message builder**
- Builder emits 4-message shape when enabled with usable prior and `n >= 2`.
- Builder falls back to single-message shape when: disabled; response null; response errored; response content empty; `n < 2`.
- Builder uses `inputs[n-1]` as the trailing user turn for both send and regenerate.

**Unit — slice**
- `setIncludeLastResponse(true)` sets the flag and marks response stale.
- `setIncludeLastResponse(false)` sets the flag and marks response stale.
- `loadSession` / `persistCurrent` round-trip the flag.

**Unit — migration**
- v4 → v5: existing sessions gain `include_last_response: false`.
- v5 fixture loads cleanly.

**E2E (Playwright)**
- Seed v5 session with `include_last_response: true`, prior response, two input chunks; submit a new chunk; assert outgoing payload shape (or, if network assertion isn't already wired, assert correct response panel state and that the saved session reflects the expected updated `inputs` and `response`).
- Toggle checkbox → `is_stale` badge appears.
- Reload the page → checkbox state preserved from IndexedDB.

Every test starts with a `// Purpose:` comment per CLAUDE.md.

## Out of scope

- Including more than one prior assistant turn (always "last response" only).
- Per-input "snapshot at response time" tracking.
- Global default for the checkbox setting across sessions.
- UI affordance to preview the exact outgoing message array.
