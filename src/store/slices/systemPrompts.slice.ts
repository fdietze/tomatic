import { StateCreator } from 'zustand';
import { AppState, SystemPromptsSlice } from '@/store/types';
import {
    deleteSystemPrompt as dbDeleteSystemPrompt,
    loadAllSystemPrompts,
    saveSystemPrompt,
} from '@/services/persistence';

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
            await saveSystemPrompt(prompt);
            await get().loadSystemPrompts();
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to add system prompt: ${error}`);
        }
    },
    updateSystemPrompt: async (oldName, prompt) => {
        try {
            if (oldName !== prompt.name) {
                await dbDeleteSystemPrompt(oldName);
            }
            await saveSystemPrompt(prompt);
            await get().loadSystemPrompts();
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to update system prompt: ${error}`);
        }
    },
    deleteSystemPrompt: async (name) => {
        try {
            await dbDeleteSystemPrompt(name);
            await get().loadSystemPrompts();
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to delete system prompt: ${error}`);
        }
    },
});