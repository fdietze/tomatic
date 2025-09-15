import { StateCreator } from 'zustand';
import { AppState, UtilitySlice } from '@/store/types';
import { dispatchEvent } from '@/utils/events';

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
        if (get().currentSessionId || get().isSessionLoading) {
            return;
        }
        Promise.all([get().loadSystemPrompts(), get().loadSnippets(), get().fetchModelList()])
            .then(() => {
                set({ isInitializing: false });
                dispatchEvent('app_initialized');
                void get().processDirtySnippets();
            })
            .catch((error: unknown) => {
                console.error('[STORE|init] Initialization failed:', error);
                get().setError('Initialization failed. Some features may not be available.');
                set({ isInitializing: false });
            });
    },
});