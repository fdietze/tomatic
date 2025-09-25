import { createSlice, PayloadAction, nanoid } from "@reduxjs/toolkit";
import { Message } from "@/types/chat";
import { SystemPrompt } from "@/types/storage";
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
      console.log(`[DEBUG] sessionSlice.loadSessionSuccess: setting ${action.payload.messages.length} messages:`, action.payload.messages.map(m => ({ role: m.role, content: m.content })));
      state.loading = "idle";
      state.messages = action.payload.messages;
      state.currentSessionId = action.payload.sessionId;
      state.prevSessionId = action.payload.prevId;
      state.nextSessionId = action.payload.nextId;
      console.log(`[DEBUG] sessionSlice.loadSessionSuccess: state now has ${state.messages.length} messages`);
    },
    loadSessionFailure: (state, action: PayloadAction<string>) => {
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
    },
    setHasSessions: (state, action: PayloadAction<boolean>) => {
      state.hasSessions = action.payload;
    },
    // New "Command" actions following CQRS pattern
    sendMessageRequested: (state, _action: PayloadAction<{ prompt: string }>) => {
      // Saga will intercept this. We can set loading state here.
      state.submitting = true;
      state.error = null;
    },
    editMessageRequested: (state, _action: PayloadAction<{ index: number; newPrompt: string }>) => {
      state.submitting = true;
      state.error = null;
    },
    regenerateResponseRequested: (state, _action: PayloadAction<{ index: number }>) => {
      state.submitting = true;
      state.error = null;
    },

    /** @deprecated Use specific command actions instead */
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
      console.log(`[DEBUG] sessionSlice.submitUserMessage: before - ${state.messages.length} messages, isRegeneration=${isRegeneration}, editMessageIndex=${editMessageIndex}`);

      if (
        editMessageIndex !== undefined &&
        editMessageIndex >= 0 &&
        editMessageIndex < state.messages.length
      ) {
        if (isRegeneration) {
          console.log(`[DEBUG] sessionSlice.submitUserMessage: regeneration - splicing from index ${editMessageIndex + 1}, removing ${state.messages.length - editMessageIndex - 1} messages`);
          // For regeneration, keep the message at editMessageIndex and remove only messages after it
          state.messages.splice(editMessageIndex + 1);
        } else {
          console.log(`[DEBUG] sessionSlice.submitUserMessage: edit - splicing from index ${editMessageIndex}, removing ${state.messages.length - editMessageIndex} messages`);
          // For editing, remove the message at editMessageIndex and all messages after it
          state.messages.splice(editMessageIndex);
        }
      }

      if (!isRegeneration) {
        // Add the new/edited user message.
        state.messages.push({
          id: nanoid(),
          role: "user",
          content: prompt, // Initially, content is the same as raw_content
          raw_content: prompt,
        });
      }
      console.log(`[DEBUG] sessionSlice.submitUserMessage: after - ${state.messages.length} messages`);
    },
    updateUserMessage: (state, action: PayloadAction<{ index: number; message: Message }>) => {
      if (state.messages[action.payload.index]) {
        state.messages[action.payload.index] = action.payload.message;
      }
    },
    addAssistantMessagePlaceholder: (state) => {
      state.messages.push({
        id: nanoid(),
        role: "assistant",
        content: "",
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
    setSystemPrompt: (state, action: PayloadAction<{ name: string; rawPrompt: string; resolvedPrompt: string }>) => {
      const { name, rawPrompt, resolvedPrompt } = action.payload;
      
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
      // For regular chat API failures, we keep the user message (existing behavior)
      // For snippet regeneration failures, we use setSessionError instead
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
    setSessionError: (state, action: PayloadAction<string | null>) => {
      state.submitting = false;
      state.error = action.payload;
      
      // If this is a snippet regeneration error, clean up the optimistic message
      if (action.payload && action.payload.includes("Snippet regeneration failed")) {
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
  setSystemPrompt,
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
