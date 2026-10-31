import { all, call, put, select, take } from "redux-saga/effects";
// req:saga-supervision: watcher helpers that contain worker failures
import { takeLatest } from "@/store/supervisedEffects";
import { END, eventChannel, EventChannel } from "redux-saga";
import { PayloadAction } from "@reduxjs/toolkit";
import OpenAI from "openai";
import type { Stream } from "openai/streaming";
import { SagaIterator } from "redux-saga";

import { ChatSession, Message } from "@/types/chat";
import { SystemPrompt, Snippet } from "@/types/storage";
import * as db from "@/services/db/chat-sessions";
import { streamChat, StreamChatInput } from "@/services/chatService";
import { RootState } from "../../store";

import {
  addAssistantMessagePlaceholder,
  appendChunkToLatestMessage,
  goToNextSession,
  goToPrevSession,
  loadSession,
  loadSessionFailure,
  loadSessionSuccess,
  sessionCreatedSuccess,
  sessionUpdated,
  startNewSession,
  // New command actions
  sendMessageRequested,
  editMessageRequested,
  regenerateResponseRequested,
  setSystemPromptRequested,
  setSystemPrompt,
  setSelectedPromptName,
  // Deprecated
  submitUserMessage,
  submitUserMessageFailure,
  submitUserMessageSuccess,
  selectSession,
  setHasSessions,
  loadInitialSessionSaga as loadInitialSessionSagaAction,
  SessionState,
  cancelSubmission,
  updateUserMessage,
  setSessionError,
} from "./sessionSlice";
import { getNavigationService } from "@/services/NavigationProvider";
import { ROUTES } from "@/utils/routes";
import { findSnippetReferences, resolveSnippetReferences } from "@/utils/snippetUtils";
import { setSelectedPromptName as setSettingsSelectedPromptName } from "@/store/features/settings/settingsSlice";
import {
  batchRegenerateRequest,
  selectSnippets,
} from "@/store/features/snippets/snippetsSlice";
import {
  toAppError,
  createAppError,
  getErrorMessage,
} from "@/types/errors";

// --- Helper Functions ---

// Helper function to resolve the current system prompt from state
function* resolveCurrentSystemPrompt(): SagaIterator<Message | null> {
  const { session, prompts, snippets }: RootState = yield select(
    (state: RootState) => state,
  );

  const selectedPromptName = session.selectedPromptName;
  if (!selectedPromptName) {
    return null;
  }

  const promptEntity = prompts.prompts[selectedPromptName];
  if (!promptEntity) {
    return null;
  }

  const systemPrompt = promptEntity.data;

  // Resolve snippets in the system prompt
  const resolvedPrompt: string = yield call(resolveSnippetReferences, systemPrompt.prompt, snippets.snippets);

  return {
    id: `system-${selectedPromptName}`,
    role: "system" as const,
    content: resolvedPrompt, // For API calls
    raw_content: systemPrompt.prompt, // For UI display
    prompt_name: selectedPromptName,
  };
}

// Helper function to initialize a new session with the global selected prompt
function* initializeNewSessionWithGlobalPrompt(): SagaIterator {
  // req:system-prompt-preservation
  const { settings, prompts }: RootState = yield select(
    (state: RootState) => state,
  );
  const globalSelectedPromptName = settings.selectedPromptName;

  if (globalSelectedPromptName) {
    const promptEntity = prompts.prompts[globalSelectedPromptName];
    if (promptEntity) {
      // When creating a new session, we must also dispatch `setSystemPromptRequested`
      // to ensure the system message is created with content.
      yield put(setSystemPromptRequested(promptEntity.data));
    }
  }
}

// req:auto-save-new-chat: Helper saga to create and save a new session from the current state
function* createAndSaveNewSessionSaga(): SagaIterator<string> {
  // Get current messages from Redux state
  const { session }: RootState = yield select((state: RootState) => state);
  const currentMessages = session.messages;
  // Generate a new unique session ID
  const newSessionId = crypto.randomUUID();
  // Create the ChatSession object
  const newSession: ChatSession = {
    session_id: newSessionId,
    messages: currentMessages,
    name: null,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
  };
  // Save the session to the database
  yield call(db.saveSession, newSession);
  // Find neighbor session IDs for navigation
  const { prevId, nextId } = yield call(db.findNeighbourSessionIds, newSession);
  // Update Redux state with the new session information
  yield put(sessionCreatedSuccess({
    sessionId: newSessionId,
    messages: currentMessages,
    prevId,
    nextId,
  }));
  return newSessionId;
}

// Helper saga to update an existing session in the database with current messages
function* updateExistingSessionSaga(sessionId: string): SagaIterator {
  // Get current messages from Redux state
  const { session }: RootState = yield select((state: RootState) => state);
  const currentMessages = session.messages;
  // Create updated session object
  const updatedSession = {
    session_id: sessionId,
    messages: currentMessages,
    name: null,
    created_at_ms: Date.now(), // This will be ignored by the database for existing sessions
    updated_at_ms: Date.now(),
  };
  // Update the session in the database
  yield call(db.saveSession, updatedSession);
  // Dispatch success action (no state changes needed, just confirmation)
  yield put(sessionUpdated({
    sessionId,
  }));
}

// req:chat-snippet-resolution-setting: the setting decides whether a chat user message is resolved or sent verbatim.
function resolveChatUserText(text: string, resolutionEnabled: boolean, snippets: Snippet[]): string {
  return resolutionEnabled ? resolveSnippetReferences(text, snippets) : text;
}

// --- Worker Sagas ---

// Saga to handle system prompt setting with snippet resolution
function* setSystemPromptRequestedSaga(action: PayloadAction<SystemPrompt>): SagaIterator {
  try {
    const { name } = action.payload;
    // Simply set the selected prompt name - the actual resolution will happen dynamically when needed
    yield put(setSelectedPromptName(name));
    // For backward compatibility, also resolve and set the system message in the messages array
    // This ensures the UI still displays the system prompt correctly
    const systemMessage: Message | null = yield call(resolveCurrentSystemPrompt);
    if (systemMessage) {
      const systemPromptData = {
        name: systemMessage.prompt_name!,
        rawPrompt: systemMessage.raw_content!,
        resolvedPrompt: systemMessage.content,
      };
      yield put(setSystemPrompt(systemPromptData));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const appError = createAppError.unknown(`Failed to resolve system prompt: ${errorMessage}`);
    yield put(setSessionError(appError));
  }
}

function* goToPrevSessionSaga(): SagaIterator {
  const session: SessionState = yield select(selectSession);
  const navigationService = yield call(getNavigationService);
  if (session.prevSessionId) {
    yield call(
      [navigationService, navigationService.navigate],
      ROUTES.chat.session(session.prevSessionId),
    );
  } else if (!session.currentSessionId) {
    // If there's no current session, go to the most recent one.
    const mostRecentId: string | null = yield call(db.getMostRecentSessionId);
    if (mostRecentId) {
      yield call(
        [navigationService, navigationService.navigate],
        ROUTES.chat.session(mostRecentId),
      );
    }
  }
}

function* goToNextSessionSaga(): SagaIterator {
  const session: SessionState = yield select(selectSession);
  const navigationService = yield call(getNavigationService);
  if (session.nextSessionId) {
    yield call(
      [navigationService, navigationService.navigate],
      ROUTES.chat.session(session.nextSessionId),
    );
  }
}

function* loadSessionSaga(action: PayloadAction<string>) {
  if (action.payload === "new") {
    yield put(startNewSession());
    // Initialize new session with global selected prompt
    yield call(initializeNewSessionWithGlobalPrompt);
    return;
  }
  try {
    const session: ChatSession | null = yield call(
      db.loadSession,
      action.payload,
    );
    if (session) {
      // req:system-prompt-navigation-sync: Extract prompt_name from system message and update selected prompt
      const systemMessage = session.messages.find(m => m.role === "system");
      if (systemMessage?.prompt_name) {
        // Update both session-specific and global selected prompt name
        yield put(setSelectedPromptName(systemMessage.prompt_name));
        // Also update settings to maintain consistency
        yield put(setSettingsSelectedPromptName(systemMessage.prompt_name));
      } else {
        // Deselect prompt to reflect that this session has no system prompt
        yield put(setSelectedPromptName(null));
        yield put(setSettingsSelectedPromptName(null));
      }
      const { prevId, nextId } = yield call(
        db.findNeighbourSessionIds,
        session,
      );
      yield put(
        loadSessionSuccess({
          messages: session.messages,
          sessionId: session.session_id,
          prevId,
          nextId,
        }),
      );
    } else {
      yield put(loadSessionFailure(createAppError.unknown("Session not found.")));
    }
  } catch (error) {
    yield put(loadSessionFailure(toAppError(error)));
  }
}

function* loadInitialSessionSaga(): SagaIterator {
  try {
    const hasSessions: boolean = yield call(db.hasSessions);
    yield put(setHasSessions(hasSessions));
  } catch (error) {
    // Handle potential errors if necessary
  }
}

type ChatStreamEvent = { chunk: string } | { done: true } | { error: Error };

function createChatStreamChannel(
  input: StreamChatInput,
): EventChannel<ChatStreamEvent> {
  return eventChannel((emitter) => {
    const processStream = async () => {
      try {
        const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> =
          await streamChat(input);

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            emitter({ chunk: content });
          }
        }
        emitter({ done: true });
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error("Streaming failed");
        emitter({ error: err });
      } finally {
        emitter(END);
      }
    };

    void processStream();

    // Return the unsubscribe function
    return () => {
      // In a real-world scenario with AbortController, you'd call abort() here.
    };
  });
}

// req:message-edit-fork, req:regenerate-context, req:snippet-wait-before-submit
function* submitUserMessageSaga(
  action: PayloadAction<{
    prompt: string;
    isRegeneration: boolean;
    editMessageIndex?: number;
  }>,
) {
  try {
    const { isRegeneration, prompt, editMessageIndex } = action.payload;
    // req:chat-snippet-resolution-setting: when off, user messages are sent as typed (no waiting, no resolution)
    const { chatSnippetResolutionEnabled }: RootState["settings"] = yield select(
      (state: RootState) => state.settings,
    );

    // req:snippet-wait-before-submit: --- Await Dirty Snippets ---
    const { snippets: allSnippets }: { snippets: Snippet[] } = yield select(
      (state: RootState) => state.snippets,
    );
    const snippetReferences = chatSnippetResolutionEnabled ? findSnippetReferences(prompt) : [];
    if (snippetReferences.length > 0) {
      const referencedSnippets = allSnippets.filter((s) =>
        snippetReferences.includes(s.name),
      );
      const dirtySnippets = referencedSnippets.filter((s) => s.isDirty);

      if (dirtySnippets.length > 0) {
        // Delegate to the centralized batch regeneration orchestrator
        yield put(batchRegenerateRequest({ snippets: dirtySnippets }));
        // Wait for batch completion using the window event
        yield call(() =>
          new Promise<void>((resolve) => {
            window.addEventListener("app:snippet:regeneration:batch:complete", () => resolve(), { once: true });
          })
        );
        // Check if any of the dirty snippets failed
        const currentSnippetsState = (yield select(
          (state: RootState) => state.snippets
        )) as RootState["snippets"];
        const failedSnippet = dirtySnippets.find(s =>
          currentSnippetsState.regenerationStatus[s.id]?.status === 'error'
        );
        if (failedSnippet) {
          const error = currentSnippetsState.regenerationStatus[failedSnippet.id]?.error;
          const errorMsg = error ? getErrorMessage(error) : "Unknown error";
          const snippetError = new Error(
            `Snippet '@multiple' failed: ${errorMsg}`,
          );
          // Tag the error so we know to cancel submission
          (snippetError as Error & { isSnippetError: boolean }).isSnippetError = true;
          throw snippetError;
        }
      }
    }

    // --- Resolve Snippets for Edit ---
    if (editMessageIndex !== undefined && !isRegeneration) {
      const { session, snippets }: RootState = yield select(
        (state: RootState) => state,
      );
      const messageToUpdate = session.messages[editMessageIndex];
      if (messageToUpdate) {
        try {
          const resolvedContent = resolveChatUserText(prompt, chatSnippetResolutionEnabled, snippets.snippets);
          // req:raw-content-preservation: Store raw content alongside resolved content
          const updatedMessage = { ...messageToUpdate, content: resolvedContent, raw_content: prompt };
          yield put(updateUserMessage({ index: editMessageIndex, message: updatedMessage }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          yield put(setSessionError(createAppError.unknown(errorMessage)));
          yield put(cancelSubmission());
          return; // Stop execution - don't proceed with chat API call
        }
      }
    }
    // --- Resolve Snippets for New Messages ---
    if (!isRegeneration && editMessageIndex === undefined) {
      const { session, snippets }: RootState = yield select(
        (state: RootState) => state,
      );
      // The new message was just added, so it's the last one
      const newMessageIndex = session.messages.length - 1;
      const newMessage = session.messages[newMessageIndex];
      if (newMessage && newMessage.role === 'user') {
        try {
          const resolvedContent = resolveChatUserText(prompt, chatSnippetResolutionEnabled, snippets.snippets);
          const updatedMessage = { ...newMessage, content: resolvedContent, raw_content: prompt };
          yield put(updateUserMessage({ index: newMessageIndex, message: updatedMessage }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          yield put(setSessionError(createAppError.unknown(errorMessage)));
          // Remove the placeholder assistant message if it exists
          yield put(cancelSubmission());
          return; // Stop execution - don't proceed with chat API call
        }
      }
    }

    // req:auto-save-new-chat: --- Auto-save new chat sessions ---
    // Check if we need to create a new session (after the user message is added to state)
    const { session: currentSession }: RootState = yield select(
      (state: RootState) => state,
    );
    if (currentSession.currentSessionId === null && !isRegeneration) {
      yield call(createAndSaveNewSessionSaga);
      // Note: Navigation is deferred until after the assistant response is complete
      // to avoid race conditions where the URL change triggers a state reload
    }
    // --- 1. Get state and prepare for API call ---
    const { settings, session }: RootState = yield select(
      (state: RootState) => state,
    );

    if (!settings.apiKey) {
      throw new Error("OpenRouter API key is not set.");
    }

    // Build messages to submit with fresh system prompt resolution
    let messagesToSubmit: Message[] = [];
    // First, add the current system prompt if one is selected
    const currentSystemMessage: Message | null = yield call(resolveCurrentSystemPrompt);
    if (currentSystemMessage) {
      messagesToSubmit.push(currentSystemMessage);
    }
    // Then add non-system messages from the session
    let nonSystemMessages = session.messages.filter(msg => msg.role !== 'system');
    // For regeneration, only include messages up to (but not including) the message being regenerated
    if (isRegeneration && editMessageIndex !== undefined) {
      // Convert editMessageIndex (which includes system message) to nonSystemMessages index
      const systemMessageCount = session.messages.filter(msg => msg.role === 'system').length;
      const nonSystemEditIndex = editMessageIndex - systemMessageCount;
      nonSystemMessages = nonSystemMessages.slice(0, nonSystemEditIndex);
    }
    messagesToSubmit.push(...nonSystemMessages);


    // For regenerations, resolve snippets in all user messages
    // Disabled: messages are re-sent with the content they were originally sent with.
    if (isRegeneration && chatSnippetResolutionEnabled) {
      // Resolve snippets in all user messages for regeneration
      const snippetsState: ReturnType<typeof selectSnippets> = yield select(
        (state: RootState) => state.snippets,
      );
      try {
        const newMessagesToSubmit = [];
        for (const msg of messagesToSubmit) {
          if (msg.role === 'user') {
            const originalContent = msg.raw_content || msg.content;
            const resolvedContent: string = yield call(resolveSnippetReferences, originalContent, snippetsState.snippets);
            newMessagesToSubmit.push({ ...msg, content: resolvedContent });
          } else {
            newMessagesToSubmit.push(msg);
          }
        }
        messagesToSubmit = newMessagesToSubmit;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const appError = createAppError.unknown(errorMessage);
        yield put(setSessionError(appError));
        // For regeneration, don't call cancelSubmission as there's no placeholder to clean up
        return; // Stop execution - don't proceed with chat API call
      }
    }

    if (isRegeneration && editMessageIndex !== undefined) {
      // For regeneration, clear the content of the existing assistant message in UI
      const currentMessage = session.messages[editMessageIndex];
      if (currentMessage && currentMessage.role === 'assistant') {
        yield put(updateUserMessage({ 
          index: editMessageIndex, 
          message: { ...currentMessage, content: "" }
        }));
        // req:regenerate-context: OPTION 1 IMPLEMENTATION: For regeneration, we send only the context up to the user message
        // This asks the model to "try again" with the same prompt, relying on temperature for variation
      }
    } else {
      // For new messages, add a new assistant placeholder
      yield put(addAssistantMessagePlaceholder());
    }

    // --- 2. Create the event channel ---
    const channel: EventChannel<ChatStreamEvent> = yield call(
      createChatStreamChannel,
      {
        messagesToSubmit: messagesToSubmit,
        modelName: settings.modelName,
        apiKey: settings.apiKey,
      },
    );

    // --- 3. Process events in a try/finally to ensure channel is closed ---
    try {
      while (true) {
        const event: ChatStreamEvent = yield take(channel);

        if ("chunk" in event) {
          yield put(appendChunkToLatestMessage({ chunk: event.chunk }));
        } else if ("done" in event) {
          yield put(
            submitUserMessageSuccess({ model: settings.modelName }),
          );
          // Update the session in the database now that the assistant response is complete
          const { session: finalSession }: RootState = yield select((state: RootState) => state);
          if (finalSession.currentSessionId && finalSession.currentSessionId !== "new") {
            yield call(updateExistingSessionSaga, finalSession.currentSessionId);
            // If we're still on /chat/new, navigate to the persistent session URL now
            const navigation = getNavigationService();
            const currentUrl = window.location.pathname;
            if (currentUrl === "/chat/new") {
              navigation.replace(ROUTES.chat.session(finalSession.currentSessionId));
            }
          }
          break; // Exit the loop
        } else if ("error" in event) {
          throw event.error;
        }
      }
    } finally {
      channel.close();
    }
  } catch (error) {
    const appError = toAppError(error);
    yield put(submitUserMessageFailure(appError));
    // Only cancel submission (remove user message) for snippet errors
    // For API/streaming errors, keep the user message
    if (error && typeof error === 'object' && 'isSnippetError' in error && error.isSnippetError) {
      yield put(cancelSubmission());
    }
  }
}

// --- New Orchestrator Sagas (CQRS Pattern) ---

function* sendMessageSaga(action: PayloadAction<{ prompt: string }>): SagaIterator {
  try {
    const { prompt } = action.payload;

    // Delegate to submitUserMessageSaga which handles dirty snippet waiting
    yield put(submitUserMessage({
      prompt,
      isRegeneration: false,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const appError = createAppError.snippetRegeneration('multiple', errorMessage);
    yield put(setSessionError(appError));
  }
}

function* editMessageSaga(action: PayloadAction<{ index: number; newPrompt: string }>): SagaIterator {
  try {
    const { index, newPrompt } = action.payload;

    // Delegate to submitUserMessageSaga which handles dirty snippet waiting
    yield put(submitUserMessage({
      prompt: newPrompt,
      isRegeneration: false,
      editMessageIndex: index,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    const appError = createAppError.snippetRegeneration('edit', errorMessage);
    yield put(setSessionError(appError));
  }
}

function* regenerateResponseSaga(action: PayloadAction<{ index: number }>): SagaIterator {
  try {
    const { index } = action.payload;

    // Delegate to submitUserMessageSaga which handles dirty snippet waiting
    yield put(submitUserMessage({
      prompt: "",
      isRegeneration: true,
      editMessageIndex: index,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    const appError = createAppError.snippetRegeneration('regenerate', errorMessage);
    yield put(setSessionError(appError));
  }
}

// --- Watcher Saga ---

export function* sessionSaga() {
  yield all([
    takeLatest(loadSession.type, loadSessionSaga),
    takeLatest(
      loadInitialSessionSagaAction.type,
      loadInitialSessionSaga,
    ),
    takeLatest(goToPrevSession.type, goToPrevSessionSaga),
    takeLatest(goToNextSession.type, goToNextSessionSaga),
    // New command action watchers
    takeLatest(sendMessageRequested.type, sendMessageSaga),
    takeLatest(editMessageRequested.type, editMessageSaga),
    takeLatest(regenerateResponseRequested.type, regenerateResponseSaga),
    takeLatest(setSystemPromptRequested.type, setSystemPromptRequestedSaga),
    // Deprecated (will be removed in Phase 5)
    takeLatest(submitUserMessage.type, submitUserMessageSaga),
  ]);
}
