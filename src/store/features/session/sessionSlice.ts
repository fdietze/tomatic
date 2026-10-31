import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Message } from "@/types/chat";
import { SystemPrompt } from "@/types/storage";
import { RootState } from "../../store";
import { AppError } from "@/types/errors";
import {
  LoadSessionSuccessPayload,
  SessionCreatedSuccessPayload,
  SessionUpdatedPayload,
  SendMessageRequestPayload,
  EditMessageRequestPayload,
  RegenerateResponseRequestPayload,
  UpdateUserMessagePayload,
  AppendChunkPayload,
  SubmitUserMessageSuccessPayload,
} from "@/types/payloads";

export interface SessionState {
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  hasSessions: boolean;
  loading: "idle" | "loading" | "failed";
  submitting: boolean;
  error: AppError | null;
  selectedPromptName: string | null;
}

const initialState: SessionState = {
  messages: [],
  currentSessionId: null,
  prevSessionId: null,
  nextSessionId: null,
  hasSessions: false,
  loading: "idle",
  submitting: false,
  error: null,
  selectedPromptName: null,
};

export const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {
    loadSession: (state, _action: PayloadAction<string>) => {
      state.loading = "loading";
      state.error = null;
    },
    loadSessionSuccess: (
      state,
      action: PayloadAction<LoadSessionSuccessPayload>,
    ) => {
      state.loading = "idle";
      state.messages = action.payload.messages;
      state.currentSessionId = action.payload.sessionId;
      state.prevSessionId = action.payload.prevId;
      state.nextSessionId = action.payload.nextId;
    },
    sessionCreatedSuccess: (
      state,
      action: PayloadAction<SessionCreatedSuccessPayload>,
    ) => {
      state.loading = "idle";
      state.currentSessionId = action.payload.sessionId;
      state.messages = action.payload.messages;
      state.prevSessionId = action.payload.prevId;
      state.nextSessionId = action.payload.nextId;
      state.hasSessions = true; // A new session now exists
    },

    sessionUpdated: (
      _state,
      _action: PayloadAction<SessionUpdatedPayload>,
    ) => {
      // This is just a confirmation that the session was updated in the database
      // No state changes needed since the messages are already in Redux state
    },
    loadSessionFailure: (state, action: PayloadAction<AppError>) => {
      state.loading = "failed";
      state.error = action.payload;
    },
    loadInitialSessionSaga: (state) => {
      state.loading = "loading";
      state.error = null;
    },
    startNewSession: (state) => {
      state.messages = [];
      state.currentSessionId = null;
      state.prevSessionId = null;
      state.nextSessionId = null;
      state.error = null;
      // Keep the selected prompt name when starting a new session
      // state.selectedPromptName = null; // Commented out to preserve system prompt selection
    },
    setHasSessions: (state, action: PayloadAction<boolean>) => {
      state.hasSessions = action.payload;
    },
    // New "Command" actions following CQRS pattern
    sendMessageRequested: (state, _action: PayloadAction<SendMessageRequestPayload>) => {
      // Saga will intercept this. We can set loading state here.
      state.submitting = true;
      state.error = null;
    },
    editMessageRequested: (state, _action: PayloadAction<EditMessageRequestPayload>) => {
      state.submitting = true;
      state.error = null;
    },
    regenerateResponseRequested: (state, _action: PayloadAction<RegenerateResponseRequestPayload>) => {
      state.submitting = true;
      state.error = null;
    },

    /** @deprecated Use specific command actions instead */
    // req:message-edit-fork, req:regenerate-context
    submitUserMessage: (
      state,
      action: PayloadAction<{
        prompt: string;
        isRegeneration: boolean;
        editMessageIndex?: number;
      }>,
    ) => {
      state.submitting = true;
      state.error = null;
      const { prompt, isRegeneration, editMessageIndex } = action.payload;

      if (
        editMessageIndex !== undefined &&
        editMessageIndex >= 0 &&
        editMessageIndex < state.messages.length
      ) {
        if (isRegeneration) {
          // req:regenerate-context: For regeneration, keep the message at editMessageIndex and remove only messages after it
          state.messages.splice(editMessageIndex + 1);
        } else {
          // req:message-edit-fork: For editing, remove the message at editMessageIndex and all messages after it
          state.messages.splice(editMessageIndex);
        }
      }

      if (!isRegeneration) {
        // Add the new/edited user message.
        state.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content: prompt, // Initially, content is the same as raw_content
          raw_content: prompt,
        });
      }
    },
    updateUserMessage: (state, action: PayloadAction<UpdateUserMessagePayload>) => {
      const oldMessage = state.messages[action.payload.index];
      if (oldMessage) {
        state.messages[action.payload.index] = action.payload.message;
      } else {
      }
    },
    addAssistantMessagePlaceholder: (state) => {
      state.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        raw_content: "",
      });
    },
    addSystemMessage: (state, action: PayloadAction<Message>) => {
      // Add system message at the beginning
      state.messages.unshift(action.payload);
    },
    setSystemPromptRequested: (_state, _action: PayloadAction<SystemPrompt>) => {
      // This action will be intercepted by the saga for snippet resolution
      // No state changes here - the saga will handle it
    },
    setSelectedPromptName: (state, action: PayloadAction<string | null>) => {
      state.selectedPromptName = action.payload;
    },
    setSystemPrompt: (state, action: PayloadAction<{ name: string; rawPrompt: string; resolvedPrompt: string }>) => {
      const { name, rawPrompt, resolvedPrompt } = action.payload;
      // Update the selected prompt name reference
      state.selectedPromptName = name;
      // Check if the first message is already a system message
      const firstMessage = state.messages[0];
      if (firstMessage && firstMessage.role === "system") {
        // Replace the existing system message
        firstMessage.content = resolvedPrompt; // For API calls
        firstMessage.raw_content = rawPrompt; // For UI display
        firstMessage.prompt_name = name;
      } else {
        // Create a new system message and add it to the beginning
        const systemMessage: Message = {
          id: `system-${Date.now()}`,
          role: "system",
          content: resolvedPrompt, // For API calls
          raw_content: rawPrompt, // For UI display
          prompt_name: name,
        };
        state.messages.unshift(systemMessage);
      }
    },
    // req:system-prompt-interactive-update: Remove system message when no prompt is selected
    removeSystemPrompt: (state) => {
      // Update the selected prompt name reference
      state.selectedPromptName = null;
      // Remove the first message if it's a system message
      const firstMessage = state.messages[0];
      if (firstMessage && firstMessage.role === "system") {
        state.messages.shift(); // Remove the first message
      } else {
      }
    },
    appendChunkToLatestMessage: (
      state,
      action: PayloadAction<AppendChunkPayload>,
    ) => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (lastMessage?.role === "assistant") {
        const isFirstChunk = lastMessage.content === "";
        const newChunk = action.payload.chunk;

        // For assistant messages, content and raw_content must be kept in sync.
        if (isFirstChunk) {
          // On the first chunk, we overwrite any stale data from a previous run.
          lastMessage.content = newChunk;
          lastMessage.raw_content = newChunk;
        } else {
          // On subsequent chunks, we append to both.
          lastMessage.content += newChunk;
          lastMessage.raw_content += newChunk;
        }
      } else {
      }
    },
    submitUserMessageSuccess: (
      state,
      action: PayloadAction<SubmitUserMessageSuccessPayload>,
    ) => {
      state.submitting = false;
      state.error = null;
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage?.role === "assistant") {
        lastMessage.model_name = action.payload.model;
      }
    },
    submitUserMessageFailure: (state, action: PayloadAction<AppError>) => {
      state.submitting = false;
      state.error = action.payload;
      // Clean up by removing the empty assistant placeholder if it exists
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage?.role === "assistant" && lastMessage.content === "") {
        state.messages.pop();
      }
      // For regular chat API failures, we keep the user message (existing behavior)
      // For snippet regeneration failures, we use setSessionError instead
    },
    cancelSubmission: (state) => {
      state.submitting = false;
      // Remove the last message if it was just added but failed to send
      const lastMessage = state.messages[state.messages.length - 1];
      // Remove user message that failed to send
      if (lastMessage?.role === "user") {
        state.messages.pop();
      }
      // Also remove any empty assistant placeholder
      const newLastMessage = state.messages[state.messages.length - 1];
      if (newLastMessage?.role === "assistant" && newLastMessage.content === "") {
        state.messages.pop();
      }
    },
    goToPrevSession: () => {
      // No state change, this is handled by a saga
    },
    goToNextSession: () => {
      // No state change, this is handled by a saga
    },
    setSessionError: (state, action: PayloadAction<AppError | null>) => {
      state.submitting = false;
      state.error = action.payload;
      // If this is a snippet regeneration error, clean up the optimistic message
      if (action.payload && action.payload.type === 'SNIPPET_REGENERATION_ERROR') {
        // Remove the empty assistant placeholder if it exists
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage?.role === "assistant" && lastMessage.content === "") {
          state.messages.pop();
        }
        // Also remove the user message for snippet regeneration failures
        const secondLastMessage = state.messages[state.messages.length - 1];
        if (secondLastMessage?.role === "user") {
          state.messages.pop();
        }
      }
    },
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  sessionCreatedSuccess,
  sessionUpdated,
  loadSessionFailure,
  loadInitialSessionSaga,
  startNewSession,
  setHasSessions,
  // New command actions
  sendMessageRequested,
  editMessageRequested,
  regenerateResponseRequested,
  // Deprecated
  submitUserMessage,
  updateUserMessage,
  addAssistantMessagePlaceholder,
  addSystemMessage,
  setSystemPromptRequested,
  setSelectedPromptName,
  setSystemPrompt,
  removeSystemPrompt,
  appendChunkToLatestMessage,
  submitUserMessageSuccess,
  submitUserMessageFailure,
  cancelSubmission,
  goToPrevSession,
  goToNextSession,
  setSessionError,
} = sessionSlice.actions;

export const selectSession = (state: RootState) => state.session;

export default sessionSlice.reducer;
