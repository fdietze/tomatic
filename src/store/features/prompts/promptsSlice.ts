import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SystemPrompt } from '@/types/storage';
import { RootState } from '../../store';

export interface PromptsState {
  prompts: SystemPrompt[];
  loading: 'idle' | 'loading' | 'failed';
  error: string | null;
}

const initialState: PromptsState = {
  prompts: [],
  loading: 'idle',
  error: null,
};

export const promptsSlice = createSlice({
  name: 'prompts',
  initialState,
  reducers: {
    loadPrompts: (state) => {
      state.loading = 'loading';
      state.error = null;
    },
    loadPromptsSuccess: (state, action: PayloadAction<SystemPrompt[]>) => {
      state.loading = 'idle';
      state.prompts = action.payload;
    },
    loadPromptsFailure: (state, action: PayloadAction<string>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
    addPrompt: (_state, _action: PayloadAction<SystemPrompt>) => {
      // saga will handle the logic
    },
    addPromptSuccess: (state, action: PayloadAction<SystemPrompt>) => {
      state.prompts.push(action.payload);
    },
    updatePrompt: (_state, _action: PayloadAction<{ oldName: string; prompt: SystemPrompt }>) => {
      // saga will handle the logic
    },
    updatePromptSuccess: (state, action: PayloadAction<SystemPrompt>) => {
      const index = state.prompts.findIndex(p => p.name === action.payload.name);
      if (index !== -1) {
        state.prompts[index] = action.payload;
      }
    },
    deletePrompt: (_state, _action: PayloadAction<string>) => {
      // saga will handle the logic
    },
    deletePromptSuccess: (state, action: PayloadAction<string>) => {
      state.prompts = state.prompts.filter(p => p.name !== action.payload);
    },
  },
});

export const {
  loadPrompts,
  loadPromptsSuccess,
  loadPromptsFailure,
  addPrompt,
  addPromptSuccess,
  updatePrompt,
  updatePromptSuccess,
  deletePrompt,
  deletePromptSuccess,
} = promptsSlice.actions;

export const selectPrompts = (state: RootState) => state.prompts;

export default promptsSlice.reducer;
