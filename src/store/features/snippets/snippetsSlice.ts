import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Snippet } from '@/types/storage';
import { RootState } from '../../store';

export interface SnippetsState {
  snippets: Snippet[];
  regenerationStatus: Record<string, 'in_progress' | 'error' | 'success'>;
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
    setRegenerationStatus: (state, action: PayloadAction<{ name: string; status: 'in_progress' | 'error' | 'success' }>) => {
      state.regenerationStatus[action.payload.name] = action.payload.status;
    },
    clearRegenerationStatus: (state, action: PayloadAction<string>) => {
        delete state.regenerationStatus[action.payload];
    },
    updateSnippetContent: (state, action: PayloadAction<{ name: string; content: string }>) => {
        const snippet = state.snippets.find(s => s.name === action.payload.name);
        if (snippet) {
            snippet.content = action.payload.content;
        }
    }
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
  setRegenerationStatus,
  clearRegenerationStatus,
  updateSnippetContent,
} = snippetsSlice.actions;

export const selectSnippets = (state: RootState) => state.snippets;

export default snippetsSlice.reducer;
