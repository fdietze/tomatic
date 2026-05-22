import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../../store';
import { AppError } from '@/types/errors';
import type { ScratchpadInput, ScratchpadResponse } from '@/types/scratchpad';
import type {
  AppendInputPayload,
  EditInputPayload,
  LoadScratchpadSuccessPayload,
  ScratchpadCreatedPayload,
  ScratchpadResponseChunkPayload,
  ScratchpadResponseDonePayload,
  ScratchpadResponseFailedPayload,
  SendScratchpadRequestPayload,
  RegenerateScratchpadRequestPayload,
  SetResolvedContentPayload,
} from '@/types/scratchpadPayloads';

export interface ScratchpadState {
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  hasSessions: boolean;
  selectedPromptName: string | null;
  inputs: ScratchpadInput[];
  response: ScratchpadResponse | null;
  // req:scratchpad-include-last-response: per-session opt-in to feed last
  // assistant response back as an assistant turn on next send/regen.
  includeLastResponse: boolean;
  loading: 'idle' | 'loading' | 'failed';
  submitting: boolean;
  error: AppError | null;
}

const initialState: ScratchpadState = {
  currentSessionId: null,
  prevSessionId: null,
  nextSessionId: null,
  hasSessions: false,
  selectedPromptName: null,
  inputs: [],
  response: null,
  includeLastResponse: false,
  loading: 'idle',
  submitting: false,
  error: null,
};

const markStale = (state: ScratchpadState): void => {
  if (state.response) state.response.is_stale = true;
};

export const scratchpadSlice = createSlice({
  name: 'scratchpad',
  initialState,
  reducers: {
    loadSession: (state, _action: PayloadAction<string>) => {
      state.loading = 'loading';
      state.error = null;
    },
    loadSessionSuccess: (state, action: PayloadAction<LoadScratchpadSuccessPayload>) => {
      const { session, prevId, nextId } = action.payload;
      state.loading = 'idle';
      state.currentSessionId = session.session_id;
      state.inputs = session.inputs;
      state.response = session.response;
      state.selectedPromptName = session.prompt_name ?? null;
      state.includeLastResponse = session.include_last_response;
      state.prevSessionId = prevId;
      state.nextSessionId = nextId;
    },
    loadSessionFailure: (state, action: PayloadAction<AppError>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
    sessionCreatedSuccess: (state, action: PayloadAction<ScratchpadCreatedPayload>) => {
      const { session, prevId, nextId } = action.payload;
      state.currentSessionId = session.session_id;
      state.prevSessionId = prevId;
      state.nextSessionId = nextId;
      state.hasSessions = true;
    },
    setHasSessions: (state, action: PayloadAction<boolean>) => {
      state.hasSessions = action.payload;
    },
    startNewSession: (state) => {
      state.currentSessionId = null;
      state.prevSessionId = null;
      state.nextSessionId = null;
      state.inputs = [];
      state.response = null;
      state.includeLastResponse = false;
      state.error = null;
    },
    goToPrevSession: (state) => { void state; },
    goToNextSession: (state) => { void state; },

    appendInput: (state, action: PayloadAction<AppendInputPayload>) => {
      state.inputs.push({
        id: crypto.randomUUID(),
        raw_content: action.payload.raw_content,
        resolved_content: '',
      });
    },
    editInput: (state, action: PayloadAction<EditInputPayload>) => {
      const t = state.inputs.find((i) => i.id === action.payload.inputId);
      if (!t) return;
      t.raw_content = action.payload.raw_content;
      t.resolved_content = '';
      markStale(state);
    },
    deleteInput: (state, action: PayloadAction<string>) => {
      state.inputs = state.inputs.filter((i) => i.id !== action.payload);
      markStale(state);
    },
    setResolvedContent: (state, action: PayloadAction<SetResolvedContentPayload>) => {
      const t = state.inputs.find((i) => i.id === action.payload.inputId);
      if (t) t.resolved_content = action.payload.resolved_content;
    },

    setSelectedPromptName: (state, action: PayloadAction<string | null>) => {
      if (state.selectedPromptName !== action.payload) markStale(state);
      state.selectedPromptName = action.payload;
    },
    // req:scratchpad-include-last-response-stale: toggling the checkbox marks
    // the current response stale (same pattern as model / system prompt change).
    setIncludeLastResponse: (state, action: PayloadAction<boolean>) => {
      if (state.includeLastResponse !== action.payload) markStale(state);
      state.includeLastResponse = action.payload;
    },
    markResponseStale: (state) => { markStale(state); },

    sendRequested: (state, _action: PayloadAction<SendScratchpadRequestPayload>) => {
      state.submitting = true;
      state.error = null;
    },
    regenerateRequested: (state, _action: PayloadAction<RegenerateScratchpadRequestPayload>) => {
      state.submitting = true;
      state.error = null;
    },
    startGeneration: (state, action: PayloadAction<string>) => {
      state.submitting = true;
      state.response = {
        content: '',
        model_name: action.payload,
        cost: null,
        error: null,
        is_stale: false,
      };
    },
    responseChunk: (state, action: PayloadAction<ScratchpadResponseChunkPayload>) => {
      if (!state.response) return;
      state.response.content += action.payload.delta;
    },
    responseDone: (state, action: PayloadAction<ScratchpadResponseDonePayload>) => {
      state.submitting = false;
      if (!state.response) {
        state.response = {
          content: '',
          model_name: action.payload.model_name,
          cost: action.payload.cost ?? null,
          error: null,
          is_stale: false,
        };
        return;
      }
      state.response.model_name = action.payload.model_name;
      state.response.cost = action.payload.cost ?? null;
      state.response.is_stale = false;
      state.response.error = null;
    },
    responseFailed: (state, action: PayloadAction<ScratchpadResponseFailedPayload>) => {
      state.submitting = false;
      if (!state.response) {
        state.response = {
          content: '',
          model_name: '',
          cost: null,
          error: action.payload.error,
          is_stale: false,
        };
        return;
      }
      state.response.error = action.payload.error;
    },
    setError: (state, action: PayloadAction<AppError | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  loadSession,
  loadSessionSuccess,
  loadSessionFailure,
  sessionCreatedSuccess,
  setHasSessions,
  startNewSession,
  goToPrevSession,
  goToNextSession,
  appendInput,
  editInput,
  deleteInput,
  setResolvedContent,
  setSelectedPromptName,
  setIncludeLastResponse,
  markResponseStale,
  sendRequested,
  regenerateRequested,
  startGeneration,
  responseChunk,
  responseDone,
  responseFailed,
  setError,
} = scratchpadSlice.actions;

export const selectScratchpad = (state: RootState): ScratchpadState => state.scratchpad;

export default scratchpadSlice.reducer;
