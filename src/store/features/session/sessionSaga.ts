import { all, call, put, select, take, takeLatest } from "redux-saga/effects";
import { END, eventChannel, EventChannel } from "redux-saga";
import { PayloadAction, nanoid } from "@reduxjs/toolkit";
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
import { findSnippetReferences, resolveSnippetsWithTemplates } from "@/utils/snippetUtils";
import { setSelectedPromptName as setSettingsSelectedPromptName } from "@/store/features/settings/settingsSlice";
import {
  regenerateSnippetFailure,
  regenerateSnippetSuccess,
  selectSnippets,
} from "@/store/features/snippets/snippetsSlice";
import {
  toAppError,
  createAppError,
  getErrorMessage,
  AppError,
} from "@/types/errors";

// --- Helper Functions ---

// Helper function to resolve the current system prompt from state
function* resolveCurrentSystemPrompt(): SagaIterator<Message | null> {
  const { session, prompts, snippets }: RootState = yield select(
    (state: RootState) => state,
  );

  const selectedPromptName = session.selectedPromptName;
  console.log(`[DEBUG] resolveCurrentSystemPrompt: selectedPromptName from session: "${selectedPromptName}"`);
  console.log(`[DEBUG] resolveCurrentSystemPrompt: available prompts in state:`, Object.keys(prompts.prompts));
  
  if (!selectedPromptName) {
    console.log(`[DEBUG] resolveCurrentSystemPrompt: no system prompt selected`);
    return null;
  }

  const promptEntity = prompts.prompts[selectedPromptName];
  if (!promptEntity) {
    console.log(`[DEBUG] resolveCurrentSystemPrompt: system prompt "${selectedPromptName}" not found in prompts state`);
    console.log(`[DEBUG] resolveCurrentSystemPrompt: available prompt names:`, Object.keys(prompts.prompts));
    return null;
  }

  const systemPrompt = promptEntity.data;
  console.log(`[DEBUG] resolveCurrentSystemPrompt: resolving system prompt "${selectedPromptName}" with content: "${systemPrompt.prompt}"`);

  try {
    // Resolve snippets in the system prompt
    const resolvedPrompt: string = yield call(resolveSnippetsWithTemplates, systemPrompt.prompt, snippets.snippets);
    console.log(`[DEBUG] resolveCurrentSystemPrompt: resolved to: "${resolvedPrompt}"`);

    return {
      id: `system-${selectedPromptName}`,
      role: "system" as const,
      content: resolvedPrompt, // For API calls
      raw_content: systemPrompt.prompt, // For UI display
      prompt_name: selectedPromptName,
    };
  } catch (error) {
    console.log(`[DEBUG] resolveCurrentSystemPrompt: failed to resolve system prompt:`, error);
    throw error;
  }
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
  console.log(`[DEBUG] createAndSaveNewSessionSaga: starting session creation`);
  
  // Get current messages from Redux state
  const { session }: RootState = yield select((state: RootState) => state);
  const currentMessages = session.messages;
  
  console.log(`[DEBUG] createAndSaveNewSessionSaga: creating session with ${currentMessages.length} messages`);
  
  // Generate a new unique session ID
  const newSessionId = nanoid();
  
  // Create the ChatSession object
  const newSession: ChatSession = {
    session_id: newSessionId,
    messages: currentMessages,
    name: null,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
  };
  
  console.log(`[DEBUG] createAndSaveNewSessionSaga: saving session ${newSessionId} to database`);
  
  // Save the session to the database
  yield call(db.saveSession, newSession);
  
  console.log(`[DEBUG] createAndSaveNewSessionSaga: finding neighbor sessions for ${newSessionId}`);
  
  // Find neighbor session IDs for navigation
  const { prevId, nextId } = yield call(db.findNeighbourSessionIds, newSession);
  
  console.log(`[DEBUG] createAndSaveNewSessionSaga: dispatching sessionCreatedSuccess`);
  
  // Update Redux state with the new session information
  yield put(sessionCreatedSuccess({
    sessionId: newSessionId,
    messages: currentMessages,
    prevId,
    nextId,
  }));
  
  console.log(`[DEBUG] createAndSaveNewSessionSaga: session ${newSessionId} created successfully`);
  
  return newSessionId;
}

// Helper saga to update an existing session in the database with current messages
function* updateExistingSessionSaga(sessionId: string): SagaIterator {
  console.log(`[DEBUG] updateExistingSessionSaga: updating session ${sessionId}`);
  
  // Get current messages from Redux state
  const { session }: RootState = yield select((state: RootState) => state);
  const currentMessages = session.messages;
  
  console.log(`[DEBUG] updateExistingSessionSaga: updating session ${sessionId} with ${currentMessages.length} messages`);
  
  // Create updated session object
  const updatedSession = {
    session_id: sessionId,
    messages: currentMessages,
    name: null,
    created_at_ms: Date.now(), // This will be ignored by the database for existing sessions
    updated_at_ms: Date.now(),
  };
  
  console.log(`[DEBUG] updateExistingSessionSaga: saving updated session ${sessionId} to database`);
  
  // Update the session in the database
  yield call(db.saveSession, updatedSession);
  
  console.log(`[DEBUG] updateExistingSessionSaga: dispatching sessionUpdated`);
  
  // Dispatch success action (no state changes needed, just confirmation)
  yield put(sessionUpdated({
    sessionId,
  }));
  
  console.log(`[DEBUG] updateExistingSessionSaga: session ${sessionId} updated successfully`);
}

// --- Worker Sagas ---

// Saga to handle system prompt setting with snippet resolution
function* setSystemPromptRequestedSaga(action: PayloadAction<SystemPrompt>): SagaIterator {
  try {
    const { name } = action.payload;
    console.log(`[DEBUG] setSystemPromptSaga: setting selected system prompt to "${name}"`);
    
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
      console.log(`[DEBUG] setSystemPromptSaga: dispatching setSystemPrompt with data:`, systemPromptData);
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
      console.log(`[DEBUG] loadSessionSaga: loaded session with ${session.messages.length} messages:`, session.messages.map(m => ({ role: m.role, content: m.content })));

      // req:system-prompt-navigation-sync: Extract prompt_name from system message and update selected prompt
      const systemMessage = session.messages.find(m => m.role === "system");
      const selectedPromptName = systemMessage?.prompt_name || null;
      console.log(`[DEBUG] loadSessionSaga: determined selectedPromptName: "${selectedPromptName}"`);

      // Also update settings to maintain consistency across the app
      yield put(setSettingsSelectedPromptName(selectedPromptName));

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
          selectedPromptName,
        }),
      );
      console.log(`[DEBUG] loadSessionSaga: dispatched loadSessionSuccess with ${session.messages.length} messages`);
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
    console.log("[DEBUG] checkForExistingSessions: failure", error);
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

type SnippetCompletionAction = {
  type: string;
  payload: { name: string; error?: string };
};

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
    console.log(`[DEBUG] submitUserMessageSaga: started with prompt="${prompt}", isRegeneration=${isRegeneration}, editMessageIndex=${editMessageIndex}`);

    // --- Resolve Snippets for Edit ---
    if (editMessageIndex !== undefined && !isRegeneration) {
      console.log(`[DEBUG] submitUserMessageSaga: resolving snippets for edit at index ${editMessageIndex}`);
      const { session, snippets }: RootState = yield select(
        (state: RootState) => state,
      );
      const messageToUpdate = session.messages[editMessageIndex];
      if (messageToUpdate) {
        console.log(`[DEBUG] submitUserMessageSaga: resolving prompt "${prompt}" with ${snippets.snippets.length} snippets available`);
        try {
          const resolvedContent: string = yield call(resolveSnippetsWithTemplates, prompt, snippets.snippets);
          console.log(`[DEBUG] submitUserMessageSaga: resolved content: "${resolvedContent}"`);
          // req:raw-content-preservation: Store raw content alongside resolved content
          const updatedMessage = { ...messageToUpdate, content: resolvedContent, raw_content: prompt };
          yield put(updateUserMessage({ index: editMessageIndex, message: updatedMessage }));
        } catch (error) {
          console.log(`[DEBUG] submitUserMessageSaga: edit message resolution failed:`, error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          yield put(setSessionError(createAppError.unknown(errorMessage)));
          yield put(cancelSubmission());
          return; // Stop execution - don't proceed with chat API call
        }
      }
    }
    
    // --- Resolve Snippets for New Messages ---
    if (!isRegeneration && editMessageIndex === undefined) {
      console.log(`[DEBUG] submitUserMessageSaga: resolving snippets for new message`);
      const { session, snippets }: RootState = yield select(
        (state: RootState) => state,
      );
      // The new message was just added, so it's the last one
      const newMessageIndex = session.messages.length - 1;
      const newMessage = session.messages[newMessageIndex];
      if (newMessage && newMessage.role === 'user') {
        console.log(`[DEBUG] submitUserMessageSaga: resolving new message "${prompt}" with ${snippets.snippets.length} snippets available`);
        try {
          const resolvedContent: string = yield call(resolveSnippetsWithTemplates, prompt, snippets.snippets);
          console.log(`[DEBUG] submitUserMessageSaga: resolved new message content: "${resolvedContent}"`);
          const updatedMessage = { ...newMessage, content: resolvedContent, raw_content: prompt };
          yield put(updateUserMessage({ index: newMessageIndex, message: updatedMessage }));
        } catch (error) {
          console.log(`[DEBUG] submitUserMessageSaga: new message resolution failed:`, error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`[DEBUG] submitUserMessageSaga: dispatching setSessionError with message: "${errorMessage}"`);
          yield put(setSessionError(createAppError.unknown(errorMessage)));
          console.log(`[DEBUG] submitUserMessageSaga: dispatching cancelSubmission`);
          // Remove the placeholder assistant message if it exists
          yield put(cancelSubmission());
          console.log(`[DEBUG] submitUserMessageSaga: error handling complete, returning early`);
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
      console.log(`[DEBUG] submitUserMessageSaga: no current session, creating new session with ${currentSession.messages.length} messages`);
      const newSessionId: string = yield call(createAndSaveNewSessionSaga);
      
      // Note: Navigation is deferred until after the assistant response is complete
      // to avoid race conditions where the URL change triggers a state reload
      console.log(`[DEBUG] submitUserMessageSaga: session ${newSessionId} created, navigation deferred until completion`);
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
      console.log(`[DEBUG] submitUserMessageSaga: added resolved system message: "${currentSystemMessage.content}"`);
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
    
    console.log(`[DEBUG] submitUserMessageSaga: session.messages:`, session.messages.map((m, i) => ({ sessionIndex: i, role: m.role, content: m.content.substring(0, 30) + '...' })));
    console.log(`[DEBUG] submitUserMessageSaga: nonSystemMessages:`, nonSystemMessages.map((m, i) => ({ nonSystemIndex: i, role: m.role, content: m.content.substring(0, 30) + '...' })));
    console.log(`[DEBUG] submitUserMessageSaga: initial messages to submit (${messagesToSubmit.length}):`, messagesToSubmit.map((m, i) => ({ submitIndex: i, role: m.role, content: m.content.substring(0, 30) + '...' })));
    console.log(`[DEBUG] submitUserMessageSaga: isRegeneration=${isRegeneration}, editMessageIndex=${editMessageIndex}`);


    // For regenerations, resolve snippets in all user messages
    if (isRegeneration) {
      console.log(`[DEBUG] submitUserMessageSaga: handling regeneration, resolving snippets in messages`);
      
      // Resolve snippets in all user messages for regeneration
      const snippetsState: ReturnType<typeof selectSnippets> = yield select(
        (state: RootState) => state.snippets,
      );
      console.log(`[DEBUG] submitUserMessageSaga: resolving snippets in ${messagesToSubmit.length} messages for regeneration`);
      console.log(`[DEBUG] submitUserMessageSaga: snippets state:`, snippetsState);
      console.log(`[DEBUG] submitUserMessageSaga: snippetsState.snippets:`, snippetsState.snippets);
      try {
        const newMessagesToSubmit = [];
        for (const msg of messagesToSubmit) {
          if (msg.role === 'user') {
            const originalContent = msg.raw_content || msg.content;
            console.log(`[DEBUG] submitUserMessageSaga: resolving user message "${originalContent}"`);
            const resolvedContent: string = yield call(resolveSnippetsWithTemplates, originalContent, snippetsState.snippets);
            console.log(`[DEBUG] submitUserMessageSaga: resolved to "${resolvedContent}"`);
            newMessagesToSubmit.push({ ...msg, content: resolvedContent });
          } else {
            newMessagesToSubmit.push(msg);
          }
        }
        messagesToSubmit = newMessagesToSubmit;
      } catch (error) {
        console.log(`[DEBUG] submitUserMessageSaga: regeneration resolution failed:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const appError = createAppError.unknown(errorMessage);
        yield put(setSessionError(appError));
        // For regeneration, don't call cancelSubmission as there's no placeholder to clean up
        return; // Stop execution - don't proceed with chat API call
      }
    }

    if (isRegeneration && editMessageIndex !== undefined) {
      // For regeneration, clear the content of the existing assistant message in UI
      console.log(`[DEBUG] submitUserMessageSaga: clearing assistant message at index ${editMessageIndex} for regeneration`);
      console.log(`[DEBUG] submitUserMessageSaga: messagesToSubmit before clearing:`, messagesToSubmit.map((m, i) => ({ index: i, role: m.role, content: m.content.substring(0, 30) + '...' })));
      const currentMessage = session.messages[editMessageIndex];
      if (currentMessage && currentMessage.role === 'assistant') {
        console.log(`[DEBUG] submitUserMessageSaga: found assistant message to clear:`, { role: currentMessage.role, content: currentMessage.content });
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

    console.log(`[DEBUG] submitUserMessageSaga: final messagesToSubmit before API call:`, messagesToSubmit.map(m => ({ role: m.role, content: m.content, id: m.id })));
    console.log(`[DEBUG] submitUserMessageSaga: messages after clearing logic - count: ${messagesToSubmit.length}`);
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
        console.log(`[DEBUG] submitUserMessageSaga: received streaming event:`, event);

        if ("chunk" in event) {
          console.log(`[DEBUG] submitUserMessageSaga: processing chunk: "${event.chunk}"`);
          yield put(appendChunkToLatestMessage({ chunk: event.chunk }));
        } else if ("done" in event) {
          console.log(`[DEBUG] submitUserMessageSaga: streaming complete, finalizing response`);
          yield put(
            submitUserMessageSuccess({ model: settings.modelName }),
          );
          
          // Update the session in the database now that the assistant response is complete
          const { session: finalSession }: RootState = yield select((state: RootState) => state);
          if (finalSession.currentSessionId && finalSession.currentSessionId !== "new") {
            console.log(`[DEBUG] submitUserMessageSaga: stream complete, updating session ${finalSession.currentSessionId} in database`);
            yield call(updateExistingSessionSaga, finalSession.currentSessionId);
            
            // If we're still on /chat/new, navigate to the persistent session URL now
            const navigation = getNavigationService();
            const currentUrl = window.location.pathname;
            if (currentUrl === "/chat/new") {
              console.log(`[DEBUG] submitUserMessageSaga: navigating from /chat/new to /chat/${finalSession.currentSessionId}`);
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
    console.log(`[DEBUG] submitUserMessageSaga: caught error in main catch block:`, error);
    const appError = toAppError(error);
    yield put(submitUserMessageFailure(appError));
  }
}

// --- New Orchestrator Sagas (CQRS Pattern) ---

function* waitForSnippets(snippetsToWaitFor: Snippet[]): SagaIterator {
  const remainingSnippetNames = new Set(snippetsToWaitFor.map((s) => s.name));

  if (remainingSnippetNames.size === 0) {
    return;
  }

  console.log(`[DEBUG] waitForSnippets: waiting for ${remainingSnippetNames.size} snippets to complete:`, Array.from(remainingSnippetNames));

  const results: SnippetCompletionAction[] = [];

  while (remainingSnippetNames.size > 0) {
    const result: SnippetCompletionAction = yield take([
      regenerateSnippetSuccess.type,
      regenerateSnippetFailure.type,
    ]);
    console.log(`[DEBUG] waitForSnippets: received regeneration result:`, result.type, result.payload);

    if (remainingSnippetNames.has(result.payload.name)) {
      console.log(`[DEBUG] waitForSnippets: snippet ${result.payload.name} completed, removing from waiting list`);
      remainingSnippetNames.delete(result.payload.name);
      results.push(result);
    } else {
      console.log(`[DEBUG] waitForSnippets: ignoring result for ${result.payload.name}, not in waiting list`);
    }
  }

  console.log(`[DEBUG] waitForSnippets: all snippets completed, checking for failures`);
  const failedSnippets = results.filter(
    (r) => r.type === regenerateSnippetFailure.type,
  );

  if (failedSnippets.length > 0) {
    const errorMessages = failedSnippets.map(result => {
      const error = (result.payload as { error?: AppError }).error;
      // The error from the snippet slice already contains the full message.
      return error ? getErrorMessage(error) : `Snippet '@${result.payload.name}' failed: Unknown error`;
    }).join(", ");

    console.log(`[DEBUG] waitForSnippets: found failed snippets:`, errorMessages);
    throw new Error(errorMessages);
  }

  console.log(`[DEBUG] waitForSnippets: all snippets regenerated successfully, proceeding`);
}

function* sendMessageSaga(action: PayloadAction<{ prompt: string }>): SagaIterator {
  try {
    const { prompt } = action.payload;
    console.log(`[DEBUG] sendMessageSaga: started with prompt="${prompt}"`);

    const { snippets }: RootState = yield select(
      (state: RootState) => state,
    );

    const snippetReferences = findSnippetReferences(prompt);
    const referencedSnippets = snippets.snippets.filter((s: Snippet) =>
      snippetReferences.includes(s.name),
    );
    const dirtySnippets = referencedSnippets.filter((s: Snippet) => s.isDirty);

    console.log(`[DEBUG] sendMessageSaga: found ${dirtySnippets.length} dirty snippets:`, dirtySnippets.map((s: Snippet) => s.name));

    if (dirtySnippets.length > 0) {
      yield call(waitForSnippets, dirtySnippets);
    }
    
    yield put(submitUserMessage({
      prompt,
      isRegeneration: false,
    }));
  } catch (error) {
    console.log(`[DEBUG] sendMessageSaga: caught error:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const appError = createAppError.snippetRegeneration('multiple', errorMessage);
    yield put(setSessionError(appError));
  }
}

function* editMessageSaga(action: PayloadAction<{ index: number; newPrompt: string }>): SagaIterator {
  try {
    const { index, newPrompt } = action.payload;
    console.log(`[DEBUG] editMessageSaga: started with index=${index}, newPrompt="${newPrompt}"`);

    const { snippets } = yield select((state: RootState) => state);

    const snippetReferences = findSnippetReferences(newPrompt);
    const referencedSnippets = snippets.snippets.filter((s: Snippet) =>
      snippetReferences.includes(s.name),
    );
    const dirtySnippets = referencedSnippets.filter((s: Snippet) => s.isDirty);

    console.log(`[DEBUG] editMessageSaga: found ${dirtySnippets.length} dirty snippets:`, dirtySnippets.map((s: Snippet) => s.name));

    if (dirtySnippets.length > 0) {
      yield call(waitForSnippets, dirtySnippets);
    }

    yield put(submitUserMessage({
      prompt: newPrompt,
      isRegeneration: false,
      editMessageIndex: index,
    }));
  } catch (error) {
    console.log(`[DEBUG] editMessageSaga: caught error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    const appError = createAppError.snippetRegeneration('edit', errorMessage);
    yield put(setSessionError(appError));
  }
}

function* regenerateResponseSaga(action: PayloadAction<{ index: number }>): SagaIterator {
  try {
    const { index } = action.payload;
    console.log(`[DEBUG] regenerateResponseSaga: started with index=${index}`);

    const { session, snippets } = yield select((state: RootState) => state);
    
    const messagesToCheck = session.messages.slice(0, index + 1).filter((m: Message) => m.role === 'user');
    const allReferences = messagesToCheck.flatMap((m: Message) => findSnippetReferences(m.raw_content || m.content));
    const uniqueReferences = [...new Set(allReferences)];

    const referencedSnippets = snippets.snippets.filter((s: Snippet) =>
      uniqueReferences.includes(s.name),
    );
    const dirtySnippets = referencedSnippets.filter((s: Snippet) => s.isDirty);

    console.log(`[DEBUG] regenerateResponseSaga: found ${dirtySnippets.length} dirty snippets:`, dirtySnippets.map((s: Snippet) => s.name));

    if (dirtySnippets.length > 0) {
      yield call(waitForSnippets, dirtySnippets);
    }

    yield put(submitUserMessage({
      prompt: "",
      isRegeneration: true,
      editMessageIndex: index,
    }));
  } catch (error) {
    console.log(`[DEBUG] regenerateResponseSaga: caught error:`, error);
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
