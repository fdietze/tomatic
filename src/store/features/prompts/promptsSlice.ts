import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { SystemPrompt } from "@/types/storage";
import { RootState } from "../../store";

export interface PromptEntity {
  data: SystemPrompt;
  status: "idle" | "saving" | "deleting" | "failed";
  error?: string | null;
}

export interface PromptsState {
  prompts: { [name: string]: PromptEntity };
  loading: "idle" | "loading" | "failed";
  error: string | null;
}

export const initialState: PromptsState = {
  prompts: {},
  loading: "idle",
  error: null,
};

export const promptsSlice = createSlice({
  name: "prompts",
  initialState,
  reducers: {
    loadPrompts: (state) => {
      state.loading = "loading";
      state.error = null;
    },
    loadPromptsSuccess: (state, action: PayloadAction<SystemPrompt[]>) => {
      state.loading = "idle";
      state.prompts = action.payload.reduce(
        (acc: { [name: string]: PromptEntity }, prompt) => {
          acc[prompt.name] = {
            data: prompt,
            status: "idle",
            error: null,
          };
          return acc;
        },
        {},
      );
    },
    loadPromptsFailure: (state, action: PayloadAction<string>) => {
      state.loading = "failed";
      state.error = action.payload;
    },
    // Add
    addPromptRequest: (_state, _action: PayloadAction<SystemPrompt>) => {
      // Saga will handle this
    },
    addPromptSuccess: (state, action: PayloadAction<SystemPrompt>) => {
      const newPrompt = action.payload;
      state.prompts[newPrompt.name] = {
        data: newPrompt,
        status: "idle",
        error: null,
      };
    },
    addPromptFailure: (
      _state,
      _action: PayloadAction<{ name: string; error: string }>,
    ) => {
      // Optional: Handle failure, e.g., show a global error
    },
    // Update
    updatePromptRequest: (
      state,
      action: PayloadAction<{ oldName: string; prompt: SystemPrompt }>,
    ) => {
      const { oldName } = action.payload;
      if (state.prompts[oldName]) {
        state.prompts[oldName]!.status = "saving";
      }
    },
    updatePromptSuccess: (
      state,
      action: PayloadAction<{ oldName: string; prompt: SystemPrompt }>,
    ) => {
      const { oldName, prompt } = action.payload;
      // If name was changed, we need to remove the old entry
      if (oldName !== prompt.name) {
        delete state.prompts[oldName];
      }
      state.prompts[prompt.name] = {
        data: prompt,
        status: "idle",
        error: null,
      };
    },
    updatePromptFailure: (
      state,
      action: PayloadAction<{ name: string; error: string }>,
    ) => {
      const { name, error } = action.payload;
      if (state.prompts[name]) {
        state.prompts[name]!.status = "failed";
        state.prompts[name]!.error = error;
      }
    },
    // Delete
    deletePromptRequest: (state, action: PayloadAction<string>) => {
      const name = action.payload;
      if (state.prompts[name]) {
        state.prompts[name]!.status = "deleting";
      }
    },
    deletePromptSuccess: (state, action: PayloadAction<string>) => {
      delete state.prompts[action.payload];
    },
    deletePromptFailure: (
      state,
      action: PayloadAction<{ name: string; error: string }>,
    ) => {
      const { name, error } = action.payload;
      if (state.prompts[name]) {
        state.prompts[name]!.status = "failed";
        state.prompts[name]!.error = error;
      }
    },
  },
});

export const {
  loadPrompts,
  loadPromptsSuccess,
  loadPromptsFailure,
  addPromptRequest,
  addPromptSuccess,
  addPromptFailure,
  updatePromptRequest,
  updatePromptSuccess,
  updatePromptFailure,
  deletePromptRequest,
  deletePromptSuccess,
  deletePromptFailure,
} = promptsSlice.actions;

export const selectPrompts = (state: RootState) => state.prompts;

export default promptsSlice.reducer;
