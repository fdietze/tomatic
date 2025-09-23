import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Snippet } from '@/types/storage';
import { RootState } from '../../store';

export type RegenerationStatus = {
  status: 'in_progress' | 'error' | 'success';
  error?: string;
}

export interface SnippetsState {
  snippets: Snippet[];
  regenerationStatus: Record<string, RegenerationStatus>;
  loading: 'idle' | 'loading' | 'failed';
  error: string | null;
}

const initialState: SnippetsState = {
  snippets: [],
  regenerationStatus: {},
  loading: 'idle',
  error: null,
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
    loadSnippetsFailure: (state, action: PayloadAction<string>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
    addSnippet: (_state, _action: PayloadAction<Snippet>) => {
      // saga will handle the logic
    },
    addSnippetSuccess: (state, action: PayloadAction<Snippet>) => {
      state.snippets.push(action.payload);
    },
    updateSnippet: (_state, _action: PayloadAction<{ oldName: string; snippet: Snippet }>) => {
      // saga will handle the logic
    },
    updateSnippetSuccess: (state, action: PayloadAction<{ oldName: string; snippet: Snippet }>) => {
      const index = state.snippets.findIndex(s => s.name === action.payload.oldName);
      if (index !== -1) {
        state.snippets[index] = action.payload.snippet;
      }
    },
    deleteSnippet: (_state, _action: PayloadAction<string>) => {
      // saga will handle the logic
    },
    deleteSnippetSuccess: (state, action: PayloadAction<string>) => {
      state.snippets = state.snippets.filter(s => s.name !== action.payload);
    },
    regenerateSnippet: (state, action: PayloadAction<{ oldName: string; snippet: Snippet }>) => {
      const name = action.payload.oldName;
      console.log("[DEBUG] snippetsSlice: regenerateSnippet", { name });
      state.regenerationStatus[name] = { status: 'in_progress' };
    },
    regenerateSnippetSuccess: (state, action: PayloadAction<{ name: string; content: string }>) => {
        const { name, content } = action.payload;
        console.log("[DEBUG] snippetsSlice: regenerateSnippetSuccess", { name, content: content.slice(0, 20) + '...' });
        const snippet = state.snippets.find(s => s.name === name);
        if (snippet) {
            snippet.content = content;
            snippet.isDirty = false;
            snippet.generationError = null;
        }
        state.regenerationStatus[name] = { status: 'success' };
    },
    regenerateSnippetFailure: (state, action: PayloadAction<{ name: string; error: string }>) => {
        const { name, error } = action.payload;
        console.log("[DEBUG] snippetsSlice: regenerateSnippetFailure", { name, error });
        const snippet = state.snippets.find(s => s.name === name);
        if (snippet) {
          snippet.generationError = error;
        }
        state.regenerationStatus[name] = { status: 'error', error };
    },
    clearRegenerationStatus: (state, action: PayloadAction<string>) => {
        delete state.regenerationStatus[action.payload];
    },
    updateSnippetContent: (state, action: PayloadAction<{ name: string; content: string }>) => {
        const snippet = state.snippets.find(s => s.name === action.payload.name);
        if (snippet) {
            snippet.content = action.payload.content;
        }
    },
    setSnippetDirtyState: (state, action: PayloadAction<{ name: string; isDirty: boolean }>) => {
      const snippet = state.snippets.find(s => s.name === action.payload.name);
      if (snippet) {
        snippet.isDirty = action.payload.isDirty;
      }
    },
    awaitableRegenerateRequest: (_state, _action: PayloadAction<{ name: string }>) => {
      // Saga watcher will handle this.
    },
    batchRegenerateRequest: (_state, _action: PayloadAction<{ snippets: Snippet[] }>) => {
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
  updateSnippet,
  updateSnippetSuccess,
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
