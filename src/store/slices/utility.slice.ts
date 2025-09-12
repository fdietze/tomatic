import { StateCreator } from 'zustand';
import { AppState, UtilitySlice } from '@/store/types';

export const createUtilitySlice: StateCreator<
    AppState,
    [],
    [],
    UtilitySlice
> = (set, get) => ({
    error: null,
    isInitializing: true,
    initialChatPrompt: null,
    setError: (error) => {
      set({ error });
    },
    setInitialChatPrompt: (prompt) => {
      set({ initialChatPrompt: prompt });
    },
    init: () => {
        console.debug('[STORE|init] Starting application initialization.');
        Promise.all([get().loadSystemPrompts(), get().loadSnippets(), get().fetchModelList()])
            .then(() => {
                console.debug('[STORE|init] System prompts, snippets, and model list loaded successfully.');
                set({ isInitializing: false });
            })
            .catch((error: unknown) => {
                console.error('[STORE|init] Initialization failed:', error);
                get().setError('Initialization failed. Some features may not be available.');
                set({ isInitializing: false });
            });
    },
});