import { StateCreator } from 'zustand';
import { AppState, SystemPromptsSlice } from '@/store/types';
import * as persistence from '@/services/persistence';
import { loadAllSystemPrompts } from '@/services/db';
import { getReferencedSnippetNames } from '@/utils/snippetUtils';

export const createSystemPromptsSlice: StateCreator<
    AppState,
    [],
    [],
    SystemPromptsSlice
> = (set, get) => ({
    systemPrompts: [],
    setSystemPrompts: (systemPrompts) => {
      set({ systemPrompts });
    },
    loadSystemPrompts: async () => {
        try {
            const prompts = await loadAllSystemPrompts();
            set({ systemPrompts: prompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to load system prompts: ${error}`);
        }
    },
    addSystemPrompt: async (prompt) => {
        try {
            const freshPrompts = await persistence.addSystemPrompt(prompt);
            set({ systemPrompts: freshPrompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to add system prompt: ${error}`);
        }
    },
    updateSystemPrompt: async (oldName, prompt) => {
        try {
            const freshPrompts = await persistence.updateSystemPrompt(oldName, prompt);
            set({ systemPrompts: freshPrompts });

            // When a system prompt is updated, we need to check if any snippets used in it have changed.
            // By marking them as dirty, we ensure that any dependent generated snippets are regenerated.
            const referencedSnippets = getReferencedSnippetNames(prompt.prompt);
            for (const snippetName of referencedSnippets) {
                await get()._markDependentsAsDirty(snippetName);
            }
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to update system prompt: ${error}`);
        }
    },
    deleteSystemPrompt: async (name) => {
        try {
            const freshPrompts = await persistence.deleteSystemPrompt(name);
            set({ systemPrompts: freshPrompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to delete system prompt: ${error}`);
        }
    },
});