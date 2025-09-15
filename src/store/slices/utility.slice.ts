import { StateCreator } from 'zustand';
import { AppState, UtilitySlice } from '@/store/types';
import { dispatchEvent, waitForSnippets } from '@/utils/events';
import { getReferencedSnippetNames } from '@/utils/snippetUtils';

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
    waitForDependentSnippets: async (text) => {
        const referencedNames = Array.from(getReferencedSnippetNames(text));
        if (referencedNames.length === 0) {
            return;
        }

        const regeneratingNames = get().regeneratingSnippetNames;
        console.debug(`[DEBUG] waitForDependentSnippets: Checking for dependencies. Referenced: [${referencedNames.join(', ')}]. Currently regenerating: [${regeneratingNames.join(', ')}]`);
        const namesToWaitFor = referencedNames.filter(name => regeneratingNames.includes(name));

        if (namesToWaitFor.length > 0) {
            try {
                await waitForSnippets(namesToWaitFor);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred while waiting for snippets.';
                get().setError(errorMessage);
                throw new Error(errorMessage);
            }
        }
    },
});