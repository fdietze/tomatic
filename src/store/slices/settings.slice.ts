import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, SettingsSlice } from '@/store/types';
import { Message } from '@/types/chat';
import { SystemPrompt } from '@/types/storage';

// Helper to get the current system prompt object
const getCurrentSystemPrompt = (prompts: SystemPrompt[], name: string | null): SystemPrompt | null => {
    if (!name) return null;
    return prompts.find(p => p.name === name) || null;
};

export const createSettingsSlice: StateCreator<
    AppState,
    [],
    [],
    SettingsSlice
> = (set, get) => ({
    apiKey: '',
    modelName: 'google/gemini-2.5-pro',
    input: '',
    selectedPromptName: null,
    autoScrollEnabled: false,
    setApiKey: (apiKey) => {
      set({ apiKey });
    },
    setModelName: (modelName) => {
      set({ modelName });
    },
    setInput: (input) => {
      set({ input });
    },
    toggleAutoScroll: () => {
      set((state) => ({ autoScrollEnabled: !state.autoScrollEnabled }));
    },
    setSelectedPromptName: (selectedPromptName) => {
        const { systemPrompts, messages } = get();
        const newPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
        const newMessages = [...messages];

        const systemMessageIndex = newMessages.findIndex((m) => m.role === 'system');

        if (newPrompt) {
            const newSystemMessage: Message = {
                id: uuidv4(),
                role: 'system',
                content: newPrompt.prompt,
                prompt_name: newPrompt.name,
                model_name: null,
                cost: null,
            };
            if (systemMessageIndex !== -1) {
                // Replace existing system message
                newMessages[systemMessageIndex] = newSystemMessage;
            } else {
                // Add new system message to the beginning
                newMessages.unshift(newSystemMessage);
            }
        } else if (systemMessageIndex !== -1) {
            // Remove system message if prompt is deselected
            newMessages.splice(systemMessageIndex, 1);
        }

        set({ selectedPromptName, messages: newMessages });
    },
});