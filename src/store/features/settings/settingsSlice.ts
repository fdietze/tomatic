import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "../../store";
import { LoadSettingsSuccessPayload, SaveSettingsPayload } from "@/types/payloads";

export interface SettingsState {
  apiKey: string;
  modelName: string;
  autoScrollEnabled: boolean;
  selectedPromptName: string | null;
  initialChatPrompt: string | null;
  loading: "idle" | "loading" | "failed";
  saving: "idle" | "saving" | "failed" | "saved";
}

export const initialState: SettingsState = {
  apiKey: "",
  modelName: "openai/gpt-4o",
  autoScrollEnabled: true,
  selectedPromptName: null,
  initialChatPrompt: null,
  loading: "idle",
  saving: "idle",
};

export const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    loadSettings: (state) => {
      state.loading = "loading";
    },
    loadSettingsSuccess: (
      state,
      action: PayloadAction<LoadSettingsSuccessPayload>,
    ) => {
      return {
        ...state,
        ...action.payload,
        loading: "idle",
      };
    },
    loadSettingsFailure: (state) => {
      state.loading = "failed";
    },
    saveSettings: (state, action: PayloadAction<SaveSettingsPayload>) => {
      state.saving = "saving";
      Object.assign(state, action.payload);
    },
    saveSettingsSuccess: (state) => {
      state.saving = "saved";
    },
    saveSettingsFailure: (state) => {
      state.saving = "failed";
    },
    setApiKey: (state, action: PayloadAction<string>) => {
      state.apiKey = action.payload;
    },
    setModelName: (state, action: PayloadAction<string>) => {
      state.modelName = action.payload;
    },
    toggleAutoScroll: (state) => {
      state.autoScrollEnabled = !state.autoScrollEnabled;
    },
    setSelectedPromptName: (state, action: PayloadAction<string | null>) => {
      state.selectedPromptName = action.payload;
    },
    setInitialChatPrompt: (state, action: PayloadAction<string | null>) => {
      state.initialChatPrompt = action.payload;
    },
  },
});

export const {
  loadSettings,
  loadSettingsSuccess,
  loadSettingsFailure,
  saveSettings,
  saveSettingsSuccess,
  saveSettingsFailure,
  setApiKey,
  setModelName,
  toggleAutoScroll,
  setSelectedPromptName,
  setInitialChatPrompt,
} = settingsSlice.actions;

export const selectSettings = (state: RootState): SettingsState =>
  state.settings;

export default settingsSlice.reducer;
