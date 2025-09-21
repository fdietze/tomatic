import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Message } from '@/types/chat';
import { RootState } from '../../store';

export interface SessionState {
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  loading: 'idle' | 'loading' | 'failed';
  submitting: boolean;
  error: string | null;
}

const initialState: SessionState = {
  messages: [],
  currentSessionId: null,
  prevSessionId: null,
  nextSessionId: null,
  loading: 'idle',
  submitting: false,
  error: null,
};

export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    loadSession: (state, _action: PayloadAction<string>) => {
      state.loading = 'loading';
    },
    loadSessionSuccess: (state, action: PayloadAction<{ messages: Message[], sessionId: string, prevId: string | null, nextId: string | null }>) => {
      state.loading = 'idle';
      state.messages = action.payload.messages;
      state.currentSessionId = action.payload.sessionId;
      state.prevSessionId = action.payload.prevId;
      state.nextSessionId = action.payload.nextId;
    },
    loadSessionFailure: (state, action: PayloadAction<string>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
    startNewSession: (state) => {
      state.messages = [];
      state.currentSessionId = null;
      state.prevSessionId = null;
      state.nextSessionId = null;
      state.error = null;
    },
    submitUserMessage: (state, _action: PayloadAction<string>) => {
      state.submitting = true;
    },
    submitUserMessageSuccess: (state, action: PayloadAction<Message[]>) => {
        state.submitting = false;
        state.messages = action.payload;
    },
    submitUserMessageFailure: (state, action: PayloadAction<string>) => {
        state.submitting = false;
        state.error = action.payload;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
        state.messages.push(action.payload);
    },
    updateMessages: (state, action: PayloadAction<Message[]>) => {
        state.messages = action.payload;
    },
    cancelSubmission: (state) => {
        state.submitting = false;
    }
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  startNewSession,
  submitUserMessage,
  submitUserMessageSuccess,
  submitUserMessageFailure,
  addMessage,
  updateMessages,
  cancelSubmission,
} = sessionSlice.actions;

export const selectSession = (state: RootState) => state.session;

export default sessionSlice.reducer;
