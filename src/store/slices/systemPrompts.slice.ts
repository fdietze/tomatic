import { StateCreator } from 'zustand';
import { AppState, SystemPromptsSlice } from '@/store/types';
import * as persistence from '@/services/persistence';
import { SystemPrompt } from '@/types/storage';

export const createSystemPromptsSlice: StateCreator<
    AppState,
    [],
    [],
    SystemPromptsSlice
> = (set, get) => ({
    systemPrompts: [],
    loadSystemPrompts: async () => {
        try {
            const prompts = await persistence.loadAllSystemPrompts();
            console.debug('[DEBUG] loadSystemPrompts: Loaded from DB:', JSON.stringify(prompts));
            set({ systemPrompts: prompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to load system prompts: ${error}`);
        }
    },
    addSystemPrompt: async (prompt: SystemPrompt) => {
        try {
            const freshPrompts = await persistence.addSystemPrompt(prompt);
            set({ systemPrompts: freshPrompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to add system prompt: ${error}`);
            throw new Error(error);
        }
    },
    updateSystemPrompt: async (oldName: string, prompt: SystemPrompt) => {
        try {
            const freshPrompts = await persistence.updateSystemPrompt(oldName, prompt);
            set({ systemPrompts: freshPrompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to update system prompt: ${error}`);
            throw new Error(error);
        }
    },
    deleteSystemPrompt: async (name: string) => {
        try {
            const freshPrompts = await persistence.deleteSystemPrompt(name);
            set({ systemPrompts: freshPrompts });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to delete system prompt: ${error}`);
            throw new Error(error);
        }
    },
});