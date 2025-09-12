import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, SnippetsSlice } from '@/store/types';
import {
    deleteSnippet as dbDeleteSnippet,
    loadAllSnippets,
    saveSnippet,
} from '@/services/persistence';
import { Message } from '@/types/chat';
import { requestMessageContentStreamed } from '@/api/openrouter';
import { resolveSnippets } from '@/utils/snippetUtils';

export const createSnippetsSlice: StateCreator<
    AppState,
    [],
    [],
    SnippetsSlice
> = (set, get) => ({
    snippets: [],
    loadSnippets: async () => {
        try {
            const snippets = await loadAllSnippets();
            set({ snippets });
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to load snippets: ${error}`);
        }
    },
    addSnippet: async (snippet) => {
        try {
            await saveSnippet(snippet);
            await get().loadSnippets();
            await get().regenerateDependentSnippets(snippet.name);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to add snippet: ${error}`);
        }
    },
    updateSnippet: async (oldName, snippet) => {
        try {
            if (oldName !== snippet.name) {
                await dbDeleteSnippet(oldName);
            }
            await saveSnippet(snippet);
            await get().loadSnippets();
            await get().regenerateDependentSnippets(snippet.name);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to update snippet: ${error}`);
        }
    },
    deleteSnippet: async (name) => {
        try {
            await dbDeleteSnippet(name);
            await get().loadSnippets();
            await get().regenerateDependentSnippets(name);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to delete snippet: ${error}`);
        }
    },
    generateSnippetContent: async (snippet) => {
        const { apiKey, snippets } = get();
        if (!snippet.isGenerated || !snippet.prompt || !snippet.model || !apiKey) {
            throw new Error('Snippet is not a valid generated snippet.');
        }

        const resolvedPrompt = resolveSnippets(snippet.prompt, snippets);
        if (resolvedPrompt.trim() === '') {
            return { ...snippet, content: '' }; // Skip generation, return empty content
        }

        const messages: Message[] = [{ id: uuidv4(), role: 'user', content: resolvedPrompt }];
        const stream = await requestMessageContentStreamed(messages, snippet.model, apiKey);

        let newContent = '';
        for await (const chunk of stream) {
            newContent += chunk.choices[0]?.delta?.content || '';
        }

        return { ...snippet, content: newContent };
    },
    regenerateDependentSnippets: async (updatedSnippetName) => {
        const { snippets } = get();
        const dependentSnippets = snippets.filter(s =>
            s.isGenerated && s.prompt?.includes(`@${updatedSnippetName}`)
        );

        for (const dependent of dependentSnippets) {
            try {
                const updatedSnippet = await get().generateSnippetContent(dependent);
                await saveSnippet(updatedSnippet);
            } catch (e) {
                console.error(`Failed to regenerate dependent snippet @${dependent.name}:`, e);
                // Decide if we should show an error to the user
            }
        }
        await get().loadSnippets(); // Reload all snippets to reflect changes
    },
});