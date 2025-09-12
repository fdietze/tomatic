import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState } from './types';
import { createSettingsSlice } from './slices/settings.slice';
import { createUtilitySlice } from './slices/utility.slice';
import { createModelsSlice } from './slices/models.slice';
import { createSessionSlice } from './slices/session.slice';
import { createSystemPromptsSlice } from './slices/systemPrompts.slice';
import { createSnippetsSlice } from './slices/snippets.slice';
import { createChatSlice } from './slices/chat.slice';
import { migrateStore } from './migration';

const STORAGE_KEY = 'tomatic-storage';

// This function allows us to create bound slices, which are aware of the entire AppState.

export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createSettingsSlice(...a),
      ...createUtilitySlice(...a),
      ...createModelsSlice(...a),
      ...createSessionSlice(...a),
      ...createSystemPromptsSlice(...a),
      ...createSnippetsSlice(...a),
      ...createChatSlice(...a),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1, // Increment the version to trigger migration
      migrate: migrateStore,
      partialize: (state) => ({
        // Here we select only the state that should be persisted in localStorage
        apiKey: state.apiKey,
        modelName: state.modelName,
        cachedModels: state.cachedModels,
        input: state.input,
        selectedPromptName: state.selectedPromptName,
        autoScrollEnabled: state.autoScrollEnabled,
      }),
    }
  )
);