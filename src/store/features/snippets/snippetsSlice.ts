import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Snippet } from '@/types/storage';
import { RootState } from '../../store';
import { AppError } from '@/types/errors';
import {
  AddSnippetFailurePayload,
  UpdateSnippetSuccessPayload,
  UpdateSnippetFailurePayload,
  RegenerateSnippetSuccessPayload,
  RegenerateSnippetFailurePayload,
  SetSnippetDirtyStatePayload,
  UpdateSnippetContentPayload,
  AwaitableRegenerateRequestPayload,
  BatchRegenerateRequestPayload,
} from '@/types/payloads';

export type RegenerationStatus = {
  status: 'in_progress' | 'error' | 'success';
  error?: AppError;
}

export interface SnippetsState {
  snippets: Snippet[];
  loading: 'idle' | 'loading' | 'failed';
  error: AppError | null;
  regenerationStatus: Record<
    string,
    { status: "idle" | "in_progress" | "success" | "error"; error?: AppError }
  >;
}

const initialState: SnippetsState = {
  snippets: [],
  loading: 'idle',
  error: null,
  regenerationStatus: {},
};

export const snippetsSlice = createSlice({
  name: 'snippets',
  initialState,
  reducers: {
    loadSnippets: (state) => {
      state.loading = 'loading';
      state.error = null;
    },
    loadSnippetsSuccess: (state, action: PayloadAction<Snippet[]>) => {
      state.loading = 'idle';
      state.snippets = action.payload;
    },
    loadSnippetsFailure: (state, action: PayloadAction<AppError>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
    addSnippet: (_state, _action: PayloadAction<Snippet>) => {
      // saga will handle the logic
    },
    addSnippetSuccess: (state, action: PayloadAction<Snippet>) => {
      state.snippets.push(action.payload);
    },
    addSnippetFailure: (state, action: PayloadAction<AddSnippetFailurePayload>) => {
      // In the future, we might want to show this error in the UI.
      // For now, we'll just log it.
      console.log(`[DEBUG] Failed to add snippet '${action.payload.name}':`, action.payload.error);
    },
    updateSnippet: (_state, _action: PayloadAction<Snippet>) => {
      // saga will handle the logic
    },
    updateSnippetSuccess: (state, action: PayloadAction<UpdateSnippetSuccessPayload>) => {
      const index = state.snippets.findIndex(s => s.id === action.payload.snippet.id);
      if (index !== -1) {
        state.snippets[index] = action.payload.snippet;
      }
    },
    updateSnippetFailure: (state, action: PayloadAction<UpdateSnippetFailurePayload>) => {
      // In the future, we might want to show this error in the UI.
      const snippet = state.snippets.find(s => s.id === action.payload.id);
      if (snippet) {
        snippet.generationError = action.payload.error;
      }
    },
    deleteSnippet: (_state, _action: PayloadAction<string>) => {
      // saga will handle the logic
    },
    deleteSnippetSuccess: (state, action: PayloadAction<string>) => {
      state.snippets = state.snippets.filter(s => s.id !== action.payload);
    },
    regenerateSnippet(state, action: PayloadAction<Snippet>) {
      const snippet = state.snippets.find(s => s.id === action.payload.id);
      if (snippet) {
        state.regenerationStatus[snippet.id] = { status: "in_progress" };
      } else {
        // For new snippets not yet in the store, still track regeneration status
        state.regenerationStatus[action.payload.id] = { status: "in_progress" };
      }
    },
    regenerateSnippetSuccess(
      state,
      action: PayloadAction<RegenerateSnippetSuccessPayload>,
    ) {
      const { id, content } = action.payload;
      const snippet = state.snippets.find((s) => s.id === id);
      if (snippet) {
        snippet.content = content;
        snippet.generationError = null;
        snippet.isDirty = false;
        state.regenerationStatus[snippet.id] = { status: "success" };
      }
    },
    regenerateSnippetFailure(
      state,
      action: PayloadAction<RegenerateSnippetFailurePayload>,
    ) {
      const { id, error } = action.payload;
      const snippet = state.snippets.find((s) => s.id === id);
      if (snippet) {
        snippet.generationError = error;
        state.regenerationStatus[snippet.id] = { status: "error", error };
      } else {
        // For new snippets not yet in the store, still track regeneration status
        state.regenerationStatus[id] = { status: "error", error };
      }
    },
    clearRegenerationStatus: (state, action: PayloadAction<string>) => {
        delete state.regenerationStatus[action.payload];
    },
    updateSnippetContent: (state, action: PayloadAction<UpdateSnippetContentPayload>) => {
        const snippet = state.snippets.find(s => s.id === action.payload.id);
        if (snippet) {
            snippet.content = action.payload.content;
        }
    },
    setSnippetDirtyState: (state, action: PayloadAction<SetSnippetDirtyStatePayload>) => {
      const snippet = state.snippets.find(s => s.name === action.payload.name);
      if (snippet) {
        snippet.isDirty = action.payload.isDirty;
        // Also reset regeneration status when a snippet becomes dirty
        if (action.payload.isDirty) {
          state.regenerationStatus[snippet.id] = { status: "idle" };
        }
      }
    },
    awaitableRegenerateRequest: (_state, _action: PayloadAction<AwaitableRegenerateRequestPayload>) => {
      // Saga watcher will handle this.
    },
    batchRegenerateRequest: (_state, _action: PayloadAction<BatchRegenerateRequestPayload>) => {
      // Saga watcher will handle this.
    },
  },
});

export const {
  loadSnippets,
  loadSnippetsSuccess,
  loadSnippetsFailure,
  addSnippet,
  addSnippetSuccess,
  addSnippetFailure,
  updateSnippet,
  updateSnippetSuccess,
  updateSnippetFailure,
  deleteSnippet,
  deleteSnippetSuccess,
  regenerateSnippet,
  regenerateSnippetSuccess,
  regenerateSnippetFailure,
  clearRegenerationStatus,
  updateSnippetContent,
  setSnippetDirtyState,
  awaitableRegenerateRequest,
  batchRegenerateRequest,
} = snippetsSlice.actions;

export const selectSnippets = (state: RootState) => state.snippets;

export default snippetsSlice.reducer;
