import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Message } from "@/types/chat";
import { SystemPrompt } from "@/types/storage";
import { RootState } from "../../store";
import { AppError } from "@/types/errors";
import {
  LoadSessionSuccessPayload,
  SessionCreatedSuccessPayload,
  SendMessageRequestPayload,
  EditMessageRequestPayload,
  RegenerateResponseRequestPayload,
  TurnCommittedPayload,
  ReplyChunkReceivedPayload,
  TurnEndedPayload,
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
      state.prevSessionId = action.payload.prevId;
      state.nextSessionId = action.payload.nextId;
      state.hasSessions = true; // A new session now exists
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
    // Commands handled by sessionSaga (submitTurnSaga.ts); the reducers only flag the running turn.
    sendMessageRequested: (state, _action: PayloadAction<SendMessageRequestPayload>) => {
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

    // req:submit-turn-atomic: the turn's conversation is computed first, then committed in one step.
    // On failure before this point the session is untouched, so no rollback is needed.
    turnCommitted: (state, action: PayloadAction<TurnCommittedPayload>) => {
      state.messages = action.payload.messages;
    },
    // req:stream-bound-to-message: chunks address their reply by id. After a session switch the id is
    // absent from state.messages and the chunk is ignored, so a stream can never write into another session.
    replyChunkReceived: (state, action: PayloadAction<ReplyChunkReceivedPayload>) => {
      const reply = state.messages.find((message) => message.id === action.payload.messageId);
      if (!reply) return;
      reply.content += action.payload.chunk;
      reply.raw_content += action.payload.chunk;
    },
    turnEnded: (state, action: PayloadAction<TurnEndedPayload>) => {
      state.submitting = false;
      // Without an error of its own the turn keeps any error set meanwhile (e.g. by loadSessionFailure).
      if (action.payload.error) {
        state.error = action.payload.error;
      }
      // An empty reply carries no information (failed or cancelled before the first chunk).
      const replyIndex = state.messages.findIndex((message) => message.id === action.payload.replyMessageId);
      if (replyIndex !== -1 && state.messages[replyIndex]?.content === "") {
        state.messages.splice(replyIndex, 1);
      }
    },
    // Command: stop the running turn. sessionSaga aborts the stream and ends the turn.
    cancelSubmission: () => {},
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
    goToPrevSession: () => {
      // No state change, this is handled by a saga
    },
    goToNextSession: () => {
      // No state change, this is handled by a saga
    },
    setSessionError: (state, action: PayloadAction<AppError | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  sessionCreatedSuccess,
  loadSessionFailure,
  loadInitialSessionSaga,
  startNewSession,
  setHasSessions,
  // New command actions
  sendMessageRequested,
  editMessageRequested,
  regenerateResponseRequested,
  turnCommitted,
  replyChunkReceived,
  turnEnded,
  setSystemPromptRequested,
  setSelectedPromptName,
  setSystemPrompt,
  removeSystemPrompt,
  cancelSubmission,
  goToPrevSession,
  goToNextSession,
  setSessionError,
} = sessionSlice.actions;

export const selectSession = (state: RootState) => state.session;

export default sessionSlice.reducer;
