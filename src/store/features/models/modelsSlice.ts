import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { DisplayModelInfo } from '@/types/storage';
import { RootState } from '../../store';

export interface ModelsState {
  models: DisplayModelInfo[];
  loading: 'idle' | 'loading' | 'failed';
  error: string | null;
}

const initialState: ModelsState = {
  models: [],
  loading: 'idle',
  error: null,
};

export const modelsSlice = createSlice({
  name: 'models',
  initialState,
  reducers: {
    fetchModels: (state) => {
      state.loading = 'loading';
      state.error = null;
    },
    fetchModelsSuccess: (state, action: PayloadAction<DisplayModelInfo[]>) => {
      state.loading = 'idle';
      state.models = action.payload;
    },
    fetchModelsFailure: (state, action: PayloadAction<string>) => {
      state.loading = 'failed';
      state.error = action.payload;
    },
  },
});

export const {
  fetchModels,
  fetchModelsSuccess,
  fetchModelsFailure,
} = modelsSlice.actions;

export const selectModels = (state: RootState) => state.models;

export default modelsSlice.reducer;
