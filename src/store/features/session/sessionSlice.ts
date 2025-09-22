import { createSlice, PayloadAction, nanoid } from "@reduxjs/toolkit";
import { Message } from "@/types/chat";
import { RootState } from "../../store";

export interface SessionState {
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  hasSessions: boolean;
  loading: "idle" | "loading" | "failed";
  submitting: boolean;
  error: string | null;
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
      action: PayloadAction<{
        messages: Message[];
        sessionId: string;
        prevId: string | null;
        nextId: string | null;
      }>,
    ) => {
      state.loading = "idle";
      state.messages = action.payload.messages;
      state.currentSessionId = action.payload.sessionId;
      state.prevSessionId = action.payload.prevId;
      state.nextSessionId = action.payload.nextId;
    },
    loadSessionFailure: (state, action: PayloadAction<string>) => {
      state.loading = "failed";
      state.error = action.payload;
    },
    loadInitialSessionSaga: (state) => {
      state.loading = "loading";
      state.error = null;
    },
    initializeNewSession: (
      state,
      action: PayloadAction<{ lastSessionId: string | null }>,
    ) => {
      state.messages = [];
      state.currentSessionId = null;
      state.prevSessionId = action.payload.lastSessionId;
      state.nextSessionId = null;
      state.error = null;
    },
    setHasSessions: (state, action: PayloadAction<boolean>) => {
      state.hasSessions = action.payload;
    },
    startNewSession: (state) => {
      state.messages = [];
      state.currentSessionId = null;
      state.prevSessionId = null;
      state.nextSessionId = null;
      state.error = null;
    },
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
        state.messages.splice(editMessageIndex);
      }

      if (!isRegeneration) {
        // Add the new/edited user message.
        state.messages.push({
          id: nanoid(),
          role: "user",
          content: prompt,
        });
      }
    },
    addAssistantMessagePlaceholder: (state) => {
      state.messages.push({
        id: nanoid(),
        role: "assistant",
        content: "",
      });
    },
    appendChunkToLatestMessage: (
      state,
      action: PayloadAction<{ chunk: string }>,
    ) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage?.role === "assistant") {
        lastMessage.content += action.payload.chunk;
      }
    },
    submitUserMessageSuccess: (
      state,
      action: PayloadAction<{ model: string }>,
    ) => {
      state.submitting = false;
      state.error = null;
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage?.role === "assistant") {
        lastMessage.model_name = action.payload.model;
      }
    },
    submitUserMessageFailure: (state, action: PayloadAction<string>) => {
      state.submitting = false;
      state.error = action.payload;
      // Clean up by removing the empty assistant placeholder if it exists
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage?.role === "assistant" && lastMessage.content === "") {
        state.messages.pop();
      }
    },
    cancelSubmission: (state) => {
      state.submitting = false;
    },
    goToPrevSession: () => {
      // No state change, this is handled by a saga
    },
    goToNextSession: () => {
      // No state change, this is handled by a saga
    },
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  loadInitialSessionSaga,
  initializeNewSession,
  startNewSession,
  setHasSessions,
  submitUserMessage,
  addAssistantMessagePlaceholder,
  appendChunkToLatestMessage,
  submitUserMessageSuccess,
  submitUserMessageFailure,
  cancelSubmission,
  goToPrevSession,
  goToNextSession,
} = sessionSlice.actions;

export const selectSession = (state: RootState) => state.session;

export default sessionSlice.reducer;
