import { createSlice, PayloadAction, nanoid } from "@reduxjs/toolkit";
import { Message } from "@/types/chat";
import { RootState } from "../../store";

export interface SessionState {
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  loading: "idle" | "loading" | "failed";
  submitting: boolean;
  error: string | null;
}

const initialState: SessionState = {
  messages: [],
  currentSessionId: null,
  prevSessionId: null,
  nextSessionId: null,
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

      if (isRegeneration) {
        // The last message is the assistant's response to be regenerated. Remove it.
        // The history now ends with the user message that prompted it. The saga will
        // then resubmit this truncated history.
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage?.role === "assistant") {
          state.messages.pop();
        }
      } else {
        // This handles both new messages and edited messages.
        // If editing, truncate the history up to the message being edited.
        if (editMessageIndex !== undefined && editMessageIndex >= 0) {
          state.messages.splice(editMessageIndex);
        }
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
    submitUserMessageSuccess: (state) => {
      state.submitting = false;
      state.error = null;
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
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  startNewSession,
  submitUserMessage,
  addAssistantMessagePlaceholder,
  appendChunkToLatestMessage,
  submitUserMessageSuccess,
  submitUserMessageFailure,
  cancelSubmission,
} = sessionSlice.actions;

export const selectSession = (state: RootState) => state.session;

export default sessionSlice.reducer;
