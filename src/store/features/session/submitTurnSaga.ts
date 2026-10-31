import { call, put, race, select, take } from "redux-saga/effects";
import { EventChannel, SagaIterator } from "redux-saga";
import type { Action } from "@reduxjs/toolkit";

import { ChatSession, Message } from "@/types/chat";
import { Snippet } from "@/types/storage";
import { AppError, createAppError, describeError, getErrorMessage, toAppError } from "@/types/errors";
import * as db from "@/services/db/chat-sessions";
import { ChatRequest } from "@/services/chatService";
import { ChatStreamEvent, createChatStreamChannel } from "@/services/chatStreamChannel";
import { getNavigationService } from "@/services/NavigationProvider";
import { ROUTES } from "@/utils/routes";
import { findSnippetReferences, resolveSnippetReferences } from "@/utils/snippetUtils";
import { regenerateSnippetsInWaves } from "@/store/features/snippets/snippetsSaga";
import { RootState } from "@/store/store";
import {
  cancelSubmission,
  editMessageRequested,
  loadInitialSessionSaga,
  loadSession,
  regenerateResponseRequested,
  replyChunkReceived,
  sendMessageRequested,
  sessionCreatedSuccess,
  turnCommitted,
  turnEnded,
} from "./sessionSlice";
import {
  messagesBeforeReply,
  PreparedTurn,
  requestMessages,
  resolveUserMessages,
  TurnCommand,
} from "./conversationTurn";
import { resolveCurrentSystemPrompt } from "./resolveCurrentSystemPrompt";

/*
 * One chat turn: a user command produces one assistant reply.
 *
 *   plan    – wait for referenced dirty snippets, resolve text, compute the conversation (no state change)
 *   commit  – one reducer writes the conversation plus an empty reply; the session is stored
 *   stream  – chunks are addressed to the reply's id; the request is aborted on cancel or session switch
 *   finish  – the conversation is stored under the turn's own session id, never "whatever is loaded now"
 *
 * Inversion: every failure mode of the previous design (rollback heuristics, chunks landing in another
 * session, waiting on window events that never fire) is excluded by this order instead of being handled.
 */

export type TurnCommandAction =
  | ReturnType<typeof sendMessageRequested>
  | ReturnType<typeof editMessageRequested>
  | ReturnType<typeof regenerateResponseRequested>;

type TurnOutcome = { error: AppError | null; sessionId: string | null };

interface TurnPlan {
  sessionId: string | null;
  /** Session messages preceding the reply, as they will be stored. */
  history: Message[];
  request: ChatRequest;
}

// req:submit-turn-atomic, req:stream-bound-to-message, req:turn-cancellation
export function* submitTurnSaga(action: TurnCommandAction): SagaIterator {
  const replyMessageId = crypto.randomUUID();
  const result: { finished?: TurnOutcome } = yield race({
    finished: call(runTurn, toTurnCommand(action), replyMessageId),
    interrupted: take(isTurnInterruption),
  });
  yield put(turnEnded({ replyMessageId, error: result.finished?.error ?? null }));

  const sessionId = result.finished?.sessionId;
  if (sessionId) {
    yield call(showStoredSessionUrl, sessionId);
  }
}

function toTurnCommand(action: TurnCommandAction): TurnCommand {
  if (sendMessageRequested.match(action)) {
    return { kind: "send", prompt: action.payload.prompt };
  }
  if (editMessageRequested.match(action)) {
    return { kind: "edit", index: action.payload.index, prompt: action.payload.newPrompt };
  }
  return { kind: "regenerate", index: action.payload.index };
}

/** The user cancels, or leaves the session the turn belongs to. */
function isTurnInterruption(action: Action): boolean {
  return cancelSubmission.match(action) || loadSession.match(action) || loadInitialSessionSaga.match(action);
}

function* runTurn(command: TurnCommand, replyMessageId: string): SagaIterator<TurnOutcome> {
  let plan: TurnPlan;
  try {
    plan = yield call(planTurn, command);
  } catch (error) {
    // Nothing was committed yet, so the session stays exactly as it was.
    return { error: toAppError(error), sessionId: null };
  }
  return yield call(streamReply, plan, replyMessageId);
}

function* planTurn(command: TurnCommand): SagaIterator<TurnPlan> {
  const settings: RootState["settings"] = yield select((state: RootState) => state.settings);
  if (!settings.apiKey) {
    throw new Error("OpenRouter API key is not set.");
  }
  // req:chat-snippet-resolution-setting: when off, user messages are sent as typed (no waiting, no resolution)
  const resolutionEnabled = settings.chatSnippetResolutionEnabled;
  const turn: PreparedTurn = yield call(prepareTurn, command, resolutionEnabled);

  // Read the session after all waiting, so the commit builds on the latest messages.
  const session: RootState["session"] = yield select((state: RootState) => state.session);
  const history = messagesBeforeReply(session.messages, turn);
  const systemMessage: Message | null = yield call(resolveCurrentSystemPrompt);
  let messagesToSubmit = requestMessages(history, systemMessage);
  // req:regenerate-context: with resolution on, a regeneration picks up the current snippet content.
  // With it off, messages are re-sent with the content they were originally sent with.
  if (command.kind === "regenerate" && resolutionEnabled) {
    const snippets: Snippet[] = yield select((state: RootState) => state.snippets.snippets);
    messagesToSubmit = resolveUserMessages(messagesToSubmit, (text) => resolveSnippetReferences(text, snippets));
  }

  return {
    sessionId: session.currentSessionId,
    history,
    request: { messagesToSubmit, modelName: settings.modelName, apiKey: settings.apiKey },
  };
}

function* prepareTurn(command: TurnCommand, resolutionEnabled: boolean): SagaIterator<PreparedTurn> {
  if (command.kind === "regenerate") {
    return command;
  }
  const content: string = yield call(resolveUserText, command.prompt, resolutionEnabled);
  // req:raw-content-preservation: raw_content keeps the text as typed, content is what the model sees
  const userMessage: Message = { id: crypto.randomUUID(), role: "user", content, raw_content: command.prompt };
  return command.kind === "send"
    ? { kind: "send", userMessage }
    : { kind: "edit", index: command.index, userMessage };
}

function* resolveUserText(prompt: string, resolutionEnabled: boolean): SagaIterator<string> {
  if (!resolutionEnabled) {
    return prompt;
  }
  yield call(regenerateDirtySnippetsReferencedBy, prompt);
  const snippets: Snippet[] = yield select((state: RootState) => state.snippets.snippets);
  return resolveSnippetReferences(prompt, snippets);
}

// req:snippet-wait-before-submit: referenced snippets are regenerated first, so the message uses fresh content
function* regenerateDirtySnippetsReferencedBy(text: string): SagaIterator {
  const references = findSnippetReferences(text);
  const isReferenced = (snippet: Snippet) => references.includes(snippet.name);
  yield call(awaitRunningGenerations, isReferenced);
  const snippets: Snippet[] = yield select((state: RootState) => state.snippets.snippets);
  const dirtySnippets = snippets.filter((snippet) => snippet.isDirty && isReferenced(snippet));
  if (dirtySnippets.length === 0) {
    return;
  }
  const failures: AppError[] = yield call(regenerateSnippetsInWaves, dirtySnippets);
  const [firstFailure] = failures;
  if (firstFailure) {
    throw new Error(getErrorMessage(firstFailure));
  }
}

// A snippet that is already generating (e.g. the background regeneration after app start) is awaited
// instead of generated a second time; its failure fails the turn like a failure of our own generation.
// req:snippet-wait-by-id
function* awaitRunningGenerations(isReferenced: (snippet: Snippet) => boolean): SagaIterator {
  const runningIds = (state: RootState): string[] =>
    state.snippets.snippets
      .filter((snippet) => isReferenced(snippet) && state.snippets.regenerationStatus[snippet.id]?.status === "in_progress")
      .map((snippet) => snippet.id);
  const awaitedIds: string[] = yield select(runningIds);
  // Any action may finish a generation, so the state is re-checked after each one.
  while (((yield select(runningIds)) as string[]).length > 0) {
    yield take("*");
  }
  const statuses: RootState["snippets"]["regenerationStatus"] = yield select(
    (state: RootState) => state.snippets.regenerationStatus,
  );
  const failure = awaitedIds.map((id) => statuses[id]?.error).find((error) => error !== undefined);
  if (failure) {
    throw new Error(getErrorMessage(failure));
  }
}

function* streamReply(plan: TurnPlan, replyMessageId: string): SagaIterator<TurnOutcome> {
  const reply: Message = {
    id: replyMessageId,
    role: "assistant",
    content: "",
    raw_content: "",
    model_name: plan.request.modelName,
  };
  yield put(turnCommitted({ messages: [...plan.history, reply] }));

  let sessionId = plan.sessionId;
  let content = "";
  let error: AppError | null = null;
  let channel: EventChannel<ChatStreamEvent> | null = null;
  try {
    // req:auto-save-new-chat: the user message is stored before the reply streams
    sessionId = yield call(saveConversation, sessionId, plan.history);
    channel = yield call(createChatStreamChannel, plan.request);
    while (true) {
      const event: ChatStreamEvent = yield take(channel!);
      if ("error" in event) throw event.error;
      if ("done" in event) break;
      content += event.chunk;
      yield put(replyChunkReceived({ messageId: reply.id, chunk: event.chunk }));
    }
  } catch (caught) {
    error = toAppError(caught);
  } finally {
    // Runs on success, failure and cancellation alike: abort the request and keep what arrived.
    channel?.close();
    if (sessionId) {
      const stored = content === "" ? plan.history : [...plan.history, { ...reply, content, raw_content: content }];
      try {
        yield call(saveConversation, sessionId, stored);
      } catch (caught) {
        error = error ?? createAppError.persistence("saveSession", describeError(caught));
      }
    }
  }
  return { error, sessionId };
}

/** Stores the messages under the given session, creating the session on the first turn of a new chat. */
function* saveConversation(sessionId: string | null, messages: Message[]): SagaIterator<string> {
  const now_ms = Date.now();
  if (sessionId !== null) {
    yield call(db.updateSessionMessages, sessionId, messages, now_ms);
    return sessionId;
  }
  const session: ChatSession = {
    session_id: crypto.randomUUID(),
    messages,
    name: null,
    created_at_ms: now_ms,
    updated_at_ms: now_ms,
  };
  yield call(db.saveSession, session);
  const { prevId, nextId }: { prevId: string | null; nextId: string | null } = yield call(
    db.findNeighbourSessionIds,
    session,
  );
  yield put(sessionCreatedSuccess({ sessionId: session.session_id, prevId, nextId }));
  return session.session_id;
}

/**
 * A new chat gets its persistent URL only after the turn: navigating triggers loadSession,
 * which would interrupt a running turn.
 */
function* showStoredSessionUrl(sessionId: string): SagaIterator {
  if (window.location.pathname !== ROUTES.chat.new) {
    return;
  }
  const navigation: ReturnType<typeof getNavigationService> = yield call(getNavigationService);
  yield call([navigation, navigation.replace], ROUTES.chat.session(sessionId));
}
