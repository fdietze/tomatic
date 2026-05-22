import { call, put, select, take, takeLatest } from 'redux-saga/effects';
import { END, EventChannel, eventChannel, SagaIterator } from 'redux-saga';
import type OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
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
import {
  loadScratchpadSession,
  findNeighbourScratchpadIds,
  hasScratchpadSessions,
  getMostRecentScratchpadId,
  saveScratchpadSession,
} from '@/services/db/scratchpad-sessions';
import { createAppError } from '@/types/errors';
import { getNavigationService } from '@/services/NavigationProvider';
import { ROUTES } from '@/utils/routes';
import { resolveSnippetsWithTemplates } from '@/store/features/snippets/snippetsSaga';
import { streamChat, type StreamChatInput } from '@/services/chatService';
import { selectSettings } from '@/store/features/settings/settingsSlice';
import { selectPrompts } from '@/store/features/prompts/promptsSlice';
import type { ScratchpadSession } from '@/types/scratchpad';
import type { Message } from '@/types/chat';

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

function* goToPrevWorker(): SagaIterator {
  const s = (yield select(selectScratchpad)) as ScratchpadState;
  // Retrieve navigation service at call time (populated by NavigationProvider on mount)
  const navigationService = getNavigationService();
  if (s.prevSessionId) {
    void navigationService.navigate(ROUTES.scratchpad.session(s.prevSessionId));
    return;
  }
  if (!s.currentSessionId && s.hasSessions) {
    const id = (yield call(getMostRecentScratchpadId)) as string | null;
    if (id) {
      void navigationService.navigate(ROUTES.scratchpad.session(id));
    }
  }
}

function* goToNextWorker(): SagaIterator {
  const s = (yield select(selectScratchpad)) as ScratchpadState;
  // Retrieve navigation service at call time (populated by NavigationProvider on mount)
  const navigationService = getNavigationService();
  if (s.nextSessionId) {
    void navigationService.navigate(ROUTES.scratchpad.session(s.nextSessionId));
  }
}

// req:scratchpad-auto-save-new: Build the messages array to send to the API.
// Two shapes:
//   - default (single-aggregated-user): all inputs joined into one user message
//   - opt-in (multi-turn, req:scratchpad-include-last-response-shape):
//       [system?, user(inputs[0..n-2] joined), assistant(last response), user(inputs[n-1])]
//     Used only when includeLastResponse is on, the prior response is usable
//     (non-null, no error, non-empty content), and at least 2 input chunks exist.
//     Otherwise falls back silently to the single-aggregated shape
//     (req:scratchpad-include-last-response-fallback).
export function buildMessagesToSubmit(
  state: ScratchpadState,
  systemPromptText: string | null,
): Message[] {
  const sys = systemPromptText
    ? [{
        id: 'sys',
        role: 'system' as const,
        content: systemPromptText,
        raw_content: systemPromptText,
      }]
    : [];

  const hasUsablePrior =
    state.response != null &&
    state.response.error == null &&
    state.response.content.length > 0;
  const canSplit = state.inputs.length >= 2;

  if (state.includeLastResponse && hasUsablePrior && canSplit) {
    const last = state.inputs[state.inputs.length - 1]!;
    const earlier = state.inputs
      .slice(0, -1)
      .map((i) => i.resolved_content)
      .join('\n\n');
    return [
      ...sys,
      {
        id: 'earlier-user',
        role: 'user' as const,
        content: earlier,
        raw_content: earlier,
      },
      {
        id: 'prior-assistant',
        role: 'assistant' as const,
        content: state.response!.content,
        raw_content: state.response!.content,
      },
      {
        id: 'new-user',
        role: 'user' as const,
        content: last.resolved_content,
        raw_content: last.resolved_content,
      },
    ];
  }

  const joined = state.inputs.map((i) => i.resolved_content).join('\n\n');
  return [
    ...sys,
    {
      id: 'aggregate',
      role: 'user' as const,
      content: joined,
      raw_content: joined,
    },
  ];
}

type ChatStreamEvent =
  | { chunk: string }
  | { done: true }
  | { error: Error };

// Bridge an async iterable stream into a redux-saga EventChannel.
// This follows the same pattern used in sessionSaga to handle streaming inside generators.
function createChatStreamChannel(
  input: StreamChatInput,
): EventChannel<ChatStreamEvent> {
  return eventChannel((emitter) => {
    const processStream = async () => {
      try {
        const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> =
          await streamChat(input);
        for await (const ch of stream) {
          const content = ch.choices[0]?.delta?.content ?? '';
          if (content) emitter({ chunk: content });
        }
        emitter({ done: true });
      } catch (error) {
        emitter({ error: error instanceof Error ? error : new Error(String(error)) });
      } finally {
        emitter(END);
      }
    };
    void processStream();
    return () => { /* no cleanup needed for this stream */ };
  });
}

// Resolves the selected system prompt text through snippet references.
// Returns null if no prompt is selected or the prompt cannot be found.
function* resolveSystemPrompt(): Generator<unknown, string | null, unknown> {
  const sp = (yield select(selectScratchpad)) as ScratchpadState;
  const promptsState = (yield select(selectPrompts)) as ReturnType<typeof selectPrompts>;
  if (!sp.selectedPromptName) return null;
  const found = Object.values(promptsState.prompts).find(
    (p) => p.data.name === sp.selectedPromptName,
  );
  if (!found) return null;
  const resolved = (yield call(resolveSnippetsWithTemplates, found.data.prompt)) as string;
  return resolved;
}

// Persists the current scratchpad state to IndexedDB.
// Generates a new session_id if this is a new (unsaved) session.
function* persistCurrent(): Generator<unknown, ScratchpadSession, unknown> {
  const sp = (yield select(selectScratchpad)) as ScratchpadState;
  const now = Date.now();
  const sessionId = sp.currentSessionId ?? crypto.randomUUID();
  const session: ScratchpadSession = {
    session_id: sessionId,
    prompt_name: sp.selectedPromptName ?? null,
    inputs: sp.inputs,
    response: sp.response,
    created_at_ms: now,
    updated_at_ms: now,
    include_last_response: sp.includeLastResponse,
  };
  yield call(saveScratchpadSession, session);
  return session;
}

// Consume the stream channel, dispatching responseChunk actions per delta.
// Throws if the stream emits an error event.
function* consumeStreamChannel(
  channel: EventChannel<ChatStreamEvent>,
): Generator<unknown, void, unknown> {
  try {
    while (true) {
      const event = (yield take(channel)) as ChatStreamEvent;
      if ('chunk' in event) {
        yield put(responseChunk({ delta: event.chunk }));
      } else if ('error' in event) {
        throw event.error;
      } else {
        // done
        break;
      }
    }
  } finally {
    channel.close();
  }
}

// req:scratchpad-auto-save-new: When the user sends the first message on a new session,
// append the input, resolve snippets, persist, stream, then navigate to the new session URL.
// Navigation happens AFTER streaming completes to prevent loadSession from firing mid-stream
// and overwriting the in-progress response state (same pattern as sessionSaga).
export function* sendWorker(action: ReturnType<typeof sendRequested>): Generator<unknown, void, unknown> {
  try {
    yield put(appendInput({ raw_content: action.payload.raw_content }));
    let sp = (yield select(selectScratchpad)) as ScratchpadState;
    const newChunk = sp.inputs[sp.inputs.length - 1]!;

    // Resolve snippet references in the new input chunk
    const resolved = (yield call(resolveSnippetsWithTemplates, newChunk.raw_content)) as string;
    yield put(setResolvedContent({ inputId: newChunk.id, resolved_content: resolved }));

    const systemPromptText = (yield call(resolveSystemPrompt)) as string | null;

    sp = (yield select(selectScratchpad)) as ScratchpadState;
    const wasNew = !sp.currentSessionId;
    const persisted = (yield call(persistCurrent)) as ScratchpadSession;
    let newSessionId: string | null = null;
    if (wasNew) {
      const nb = (yield call(findNeighbourScratchpadIds, persisted)) as {
        prevId: string | null;
        nextId: string | null;
      };
      yield put(sessionCreatedSuccess({ session: persisted, prevId: nb.prevId, nextId: nb.nextId }));
      // Defer navigation until after streaming so that the loadSession triggered by the URL
      // change does not overwrite the in-flight response state mid-stream.
      newSessionId = persisted.session_id;
    }

    // Build the outgoing messages BEFORE startGeneration: that reducer resets
    // response.content to '', which would make the multi-turn builder's
    // "usable prior response" check fail (req:scratchpad-include-last-response-shape).
    const messagesToSubmit = buildMessagesToSubmit(
      (yield select(selectScratchpad)) as ScratchpadState,
      systemPromptText,
    );
    yield put(startGeneration(action.payload.modelName));
    const { apiKey } = (yield select(selectSettings)) as ReturnType<typeof selectSettings>;
    const channel: EventChannel<ChatStreamEvent> = (yield call(
      createChatStreamChannel,
      { messagesToSubmit, modelName: action.payload.modelName, apiKey },
    )) as EventChannel<ChatStreamEvent>;
    yield call(consumeStreamChannel, channel);
    yield put(responseDone({ model_name: action.payload.modelName }));
    yield call(persistCurrent);

    // Navigate to the persistent session URL now that streaming is complete.
    // Using replace:true so the /scratchpad/new entry is removed from history.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    if (newSessionId) {
      void getNavigationService().navigate(ROUTES.scratchpad.session(newSessionId), { replace: true });
    }
  } catch (e) {
    yield put(responseFailed({ error: createAppError.unknown(String(e)) }));
  }
}

// req:scratchpad-auto-save-new: Re-resolve all inputs and stream a fresh response without adding new input.
export function* regenerateWorker(action: ReturnType<typeof regenerateRequested>): Generator<unknown, void, unknown> {
  try {
    const sp0 = (yield select(selectScratchpad)) as ScratchpadState;
    // Re-resolve all existing inputs in case snippets have changed since last send
    for (const chunk of sp0.inputs) {
      const resolved = (yield call(resolveSnippetsWithTemplates, chunk.raw_content)) as string;
      yield put(setResolvedContent({ inputId: chunk.id, resolved_content: resolved }));
    }
    const systemPromptText = (yield call(resolveSystemPrompt)) as string | null;
    // Build outgoing messages BEFORE startGeneration so the prior response.content
    // remains visible to the multi-turn builder (see comment in sendWorker).
    const messagesToSubmit = buildMessagesToSubmit(
      (yield select(selectScratchpad)) as ScratchpadState,
      systemPromptText,
    );
    yield put(startGeneration(action.payload.modelName));
    const { apiKey } = (yield select(selectSettings)) as ReturnType<typeof selectSettings>;
    const channel: EventChannel<ChatStreamEvent> = (yield call(
      createChatStreamChannel,
      { messagesToSubmit, modelName: action.payload.modelName, apiKey },
    )) as EventChannel<ChatStreamEvent>;
    yield call(consumeStreamChannel, channel);
    yield put(responseDone({ model_name: action.payload.modelName }));
    yield call(persistCurrent);
  } catch (e) {
    yield put(responseFailed({ error: createAppError.unknown(String(e)) }));
  }
}

export function* scratchpadSaga() {
  yield takeLatest(loadSession.type, loadSessionWorker);
  yield takeLatest(goToPrevSession.type, goToPrevWorker);
  yield takeLatest(goToNextSession.type, goToNextWorker);
  yield takeLatest(sendRequested.type, sendWorker);
  yield takeLatest(regenerateRequested.type, regenerateWorker);
}
