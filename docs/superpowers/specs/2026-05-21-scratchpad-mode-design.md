# Scratchpad Mode — Design

## Summary

Introduce a new top-level tab "Scratchpad" alongside Chat and Settings. Scratchpad is a different mode of interacting with LLMs: instead of a full alternating user/assistant transcript, the user accumulates a list of input chunks that are concatenated into a single user message at send time. The assistant produces one response (latest only is shown). Assistant responses never flow back into the LLM. A system message is supported, as in chat.

## Goals / Non-goals

**Goals**
- Provide a dedicated UI for iterative, single-prompt construction.
- Reuse the existing snippet resolution, system prompt, model selection, and streaming infrastructure.
- Persist sessions independently from chat sessions so the two modes don't interfere.

**Non-goals**
- Multi-turn conversation in scratchpad (by design).
- Sharing or converting sessions between chat and scratchpad.
- Streaming/regeneration of past responses (only latest response is shown).

## Architecture & Routing

- New route: `/scratchpad/:sessionId`, with `/scratchpad/new` for an empty session (mirrors `/chat/:sessionId`).
- New top-nav tab "Scratchpad".
- New Redux feature slice `scratchpad` (parallel to `session`) holding the active scratchpad session in memory. Sagas handle generation, snippet resolution, and persistence — reusing the existing OpenRouter API service and snippet resolution pipeline.
- New IndexedDB object store `scratchpad_sessions`, added via a v3→v4 migration. Existing chat data is untouched.
- Scratchpad history sidebar/navigation (prev/next/new) mirrors the chat session navigation but operates on the new store.

## Data Model

```ts
interface ScratchpadInput {
  id: string;
  raw_content: string;       // user-typed, may contain @snippet refs
  resolved_content: string;  // after snippet resolution (cached)
}

interface ScratchpadResponse {
  content: string;
  model_name: string;
  cost?: MessageCost | null;
  error?: AppError | null;
  is_stale: boolean;         // true if inputs/system/model changed since last gen
}

interface ScratchpadSession {
  session_id: string;
  prompt_name?: string | null;   // selected system prompt (resolved at send time)
  inputs: ScratchpadInput[];     // ordered; joined with "\n\n" when sent
  response: ScratchpadResponse | null;
  name?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}
```

`MessageCost` and `AppError` are reused from `src/types/chat.ts` and `src/types/errors.ts`.

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│ [Chat] [Scratchpad*] [Settings]                     │
├─────────────────────────────────────────────────────┤
│ ◀ prev | session name (editable) | next ▶ | + new  │
├─────────────────────────────────────────────────────┤
│ SystemPromptBar (reused)                            │
├─────────────────────────────────────────────────────┤
│ ── Inputs ───────────────────────────────────────── │
│ ┌─────────────────────────────────────────────────┐ │
│ │ chunk 1 (collapsed plain text preview)   ✎  🗑 │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ chunk 2  …                                ✎  🗑 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ── Response ───────────────  [⟳ regenerate] [⚠stale]│
│ ┌─────────────────────────────────────────────────┐ │
│ │ assistant markdown (latest only)       [copy]   │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ [model dropdown]                                    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ textarea: new input…                            │ │
│ └─────────────────────────────────────────────────┘ │
│                                  [Send]             │
└─────────────────────────────────────────────────────┘
```

**Behaviors**
- **Inputs list**: each chunk shows a collapsed plain-text preview; click to expand to full markdown (same pattern as `req:snippet-expand-collapse`). Edit (✎) opens an inline textarea bound to `raw_content`. Delete (🗑) removes the chunk.
- **Response panel**: latest response only. Shows a stale badge when `response.is_stale === true`. Regenerate is enabled whenever a response exists (stale or not) and at least one input chunk is present.
- **Composer**: textarea + model selector + Send. Submitting appends a chunk and triggers generation.
- **Empty state**: `/scratchpad/new` shows only the system prompt bar and composer.
- **Snippet indicators**: dirty/error indicators on chunks reuse existing patterns (`req:dirty-loading-indicator`, `req:error-warning-sign`).

## Generation Flow

Send:
1. User submits composer.
2. New `ScratchpadInput` appended with `raw_content`.
3. Resolve snippets in the new chunk → `resolved_content`. Wait for any referenced snippets still generating (`req:snippet-wait-before-submit`).
4. If on `/scratchpad/new`, auto-save with a fresh `session_id` and replace the URL (mirrors `req:auto-save-new-chat`).
5. Build the request:
   - `system` = resolved selected system prompt (if any)
   - `user` = `inputs.map(i => i.resolved_content).join("\n\n")`
6. Stream the assistant response (`req:chat-stream-true`) into `session.response.content`, set `is_stale: false`, record `model_name` and `cost`.
7. Errors land in `response.error` (same `AppError` type as chat).

Regenerate: re-runs steps 5–6 against current inputs + currently selected system prompt + current model. Clears `is_stale`.

## Staleness Rules

The response is marked `is_stale: true` (without auto-regenerating) when:
- A chunk's `raw_content` is edited.
- A chunk is deleted.
- The selected system prompt changes.
- The selected model changes.

Adding a chunk via Send is not stale: it triggers generation immediately. If all inputs are deleted, the response panel is hidden and Regenerate is disabled.

## Snippet Integration

- Snippet resolution runs per chunk on edit and on send, reusing the existing snippet service.
- `req:snippet-wait-by-id` and `req:snippet-error-propagation` apply unchanged.
- A chunk with an unresolved snippet shows the standard warning sign (`req:error-warning-sign`).

## System Prompt Behavior (mirrors chat)

- Selecting a different system prompt updates the in-memory session but only persists on next send/regenerate (`req:system-prompt-interactive-update`).
- Navigating prev/next reloads the persisted `prompt_name` (`req:system-prompt-navigation-sync`).

## Persistence & Migration

- New IndexedDB object store `scratchpad_sessions` added in a v3→v4 migration. Empty for existing users; no data transformation needed.
- A migration fixture is added per `req:migration-test-fixtures`.
- Migration failures surface an error per `req:migration-error-handling`.
- localStorage is unchanged.

## New Requirements (to add to `requirements.md`)

- `req:scratchpad-mode`: dedicated tab/route with aggregated single-user-message flow; assistant responses never feed back into the LLM.
- `req:scratchpad-aggregation`: user inputs are joined with `\n\n` into a single user message at send/regen time.
- `req:scratchpad-staleness`: edit/delete of an input chunk, or change of system prompt/model, marks the response stale without regenerating; explicit user action regenerates.
- `req:scratchpad-separate-sessions`: scratchpad sessions live in their own IndexedDB store, separate from chat sessions.
- `req:scratchpad-snippet-resolution`: snippet references in scratchpad inputs resolve identically to chat (same wait/error semantics).
- `req:scratchpad-auto-save-new`: first send on `/scratchpad/new` persists and updates URL.

## Testing Strategy

- **Unit**: scratchpad slice reducers (append, edit, delete, mark-stale), join function, migration v3→v4.
- **Integration**: saga flows for send (with snippet wait), regenerate, auto-save-new, system prompt interactive update.
- **E2E (Playwright)**: tab navigation; send → response; edit chunk → stale badge; regenerate clears stale; delete-all hides response; new-session auto-save URL change; system-prompt change marks stale; model change marks stale; snippet reference resolves; unresolved snippet shows warning.

Every test gets a `// Purpose:` comment per project conventions. Tests seed IndexedDB directly rather than driving the UI for setup.
