import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, SnippetsSlice } from '@/store/types';
import * as persistence from '@/services/persistence';
import { loadAllSnippets, saveSnippet, saveSnippets } from '@/services/db/snippets';
import { Message } from '@/types/chat';
import { requestMessageContent } from '@/api/openrouter';
import {
    buildReverseDependencyGraph,
    findTransitiveDependents,
    getReferencedSnippetNames,
    resolveSnippets,
    topologicalSort,
} from '@/utils/snippetUtils';
import { Snippet } from '@/types/storage';
import { dispatchEvent } from '@/utils/events';

export const createSnippetsSlice: StateCreator<
    AppState,
    [],
    [],
    SnippetsSlice
> = (set, get) => ({
    snippets: [],
    isRegenerating: false,
    regeneratingSnippetNames: [],
    loadSnippets: async () => {
        try {
            const snippets = await loadAllSnippets();
            set({ snippets });
            return snippets;
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to load snippets: ${error}`);
            return undefined;
        }
    },
    addSnippet: async (snippet) => {
        try {
            const now = Date.now();
            
            let snippetToSave: Snippet = {
                ...snippet,
                createdAt_ms: now,
                updatedAt_ms: now,
                generationError: null,
                isDirty: false
            };

            // If the snippet is generated, generate content before the initial save.
            if (snippetToSave.isGenerated) {
                try {
                    // We pass all existing snippets so the prompt can be resolved.
                    const updatedSnippet = await get().generateSnippetContent(snippetToSave);
                    snippetToSave = { ...snippetToSave, ...updatedSnippet, generationError: null };
                } catch (e) {
                    const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                    snippetToSave.generationError = error;
                }
            }

            const freshSnippets = await persistence.addSnippet(snippetToSave);
            set({ snippets: freshSnippets });

        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to add snippet: ${error}`);
            throw new Error(error);
        }
    },
    updateSnippet: async (oldName, snippet) => {
        try {

            const existingSnippet = get().snippets.find(s => s.name === oldName);
            const snippetToSave: Snippet = {
                ...snippet,
                createdAt_ms: existingSnippet?.createdAt_ms || Date.now(),
                updatedAt_ms: Date.now(),
                isDirty: existingSnippet?.isDirty || false,
                generationError: existingSnippet?.generationError || null
            };

            const freshSnippets = await persistence.updateSnippet(oldName, snippetToSave);
            set({ snippets: freshSnippets });

            await get()._markDependentsAsDirty(snippetToSave.name);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to update snippet: ${error}`);
            throw new Error(error);
        }
    },
    deleteSnippet: async (name) => {
        try {
            const freshSnippets = await persistence.deleteSnippet(name);
            set({ snippets: freshSnippets });
            await get()._markDependentsAsDirty(name);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to delete snippet: ${error}`);
            throw new Error(error);
        }
    },
    generateSnippetContent: async (snippet) => {
        const { apiKey, snippets: allSnippets } = get();
        if (!snippet.isGenerated || !snippet.prompt || !snippet.model || !apiKey) {
            const errorMessage = 'Snippet is not a valid generated snippet.';
            console.error(`[STORE|generateSnippetContent] Aborting: ${errorMessage}`, snippet);
            throw new Error(errorMessage);
        }

        const resolvedPrompt = resolveSnippets(snippet.prompt, allSnippets);
        if (resolvedPrompt.trim() === '') {
            return { ...snippet, content: '' }; // Skip generation, return empty content
        }

        const messages: Message[] = [{ id: uuidv4(), role: 'user', content: resolvedPrompt }];
        
        const newContent = await requestMessageContent(messages, snippet.model, apiKey);
        return { ...snippet, content: newContent };
    },
    regenerateDependentSnippets: async () => {
        // This is a placeholder implementation to satisfy the type checker.
        // The actual implementation will be handled in a future task.
        return Promise.resolve();
    },
    _markDependentsAsDirty: async (changedSnippetName) => {
        const { snippets } = get();
        const reverseGraph = buildReverseDependencyGraph(snippets);
        const dependents = findTransitiveDependents(changedSnippetName, reverseGraph);

        if (dependents.size === 0) {
            return;
        }

        const now = Date.now();
        const snippetsToSave = [...snippets];

        dependents.forEach(name => {
            const snippet = snippetsToSave.find(s => s.name === name);
            if (snippet) {
                snippet.isDirty = true;
                snippet.updatedAt_ms = now;
            }
        });

        try {
            await saveSnippets(snippetsToSave);
            await get().loadSnippets();
            // Trigger regeneration asynchronously without waiting for it to complete
            void get().processDirtySnippets();
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.error(`[STORE|_markDependentsAsDirty] error`, error, e);
            get().setError(`Failed to mark dependent snippets as dirty: ${error}`);
        }
    },
    processDirtySnippets: async () => {
         if (get().isRegenerating) {
            return;
        }

        set({ isRegenerating: true, regeneratingSnippetNames: [] });
        dispatchEvent('snippet_regeneration_started');

        try {
            const allSnippets = await loadAllSnippets();
            const { sorted, cyclic } = topologicalSort(allSnippets);

            if (cyclic.length > 0) {
                const cycleError = `Snippet cycle detected: ${cyclic.join(', ')}. Please resolve the cycle to continue automatic regeneration.`;
                console.warn(`[STORE|processDirtySnippets] ${cycleError}`);
                get().setError(cycleError);
            }

            const dirtySnippets = sorted.filter(s => s.isDirty);

            if (dirtySnippets.length === 0) {
                set({ isRegenerating: false });
                return;
            }


            const dependencyErrorCache = new Map<string, string | null>();

            for (const snippet of dirtySnippets) {
                
                if (!snippet.isGenerated) {
                    const updatedSnippet = { ...snippet, isDirty: false };
                    await saveSnippet(updatedSnippet);
                    dispatchEvent('snippet_regeneration_update', { name: snippet.name, status: 'success' });
                    continue;
                }

                set(state => {
                    const newRegenerating = [...state.regeneratingSnippetNames, snippet.name];
                    return { regeneratingSnippetNames: newRegenerating };
                });

                let updatedSnippet: Snippet = { ...snippet };
                let caughtError: string | null = null;
                
                try {
                    const dependencies = Array.from(getReferencedSnippetNames(snippet.prompt || ''));
                    const upstreamErrorDep = dependencies.find(dep => dependencyErrorCache.get(dep));
                    if (upstreamErrorDep) {
                        const errorMessage = `Upstream dependency @${upstreamErrorDep} failed to generate.`;
                        throw new Error(errorMessage);
                    }

                    const regenerated = await get().generateSnippetContent(snippet);
                    updatedSnippet = { ...regenerated, isDirty: false, generationError: null };
                    dependencyErrorCache.set(snippet.name, null);
                } catch (e) {
                    const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                    updatedSnippet = { ...snippet, isDirty: false, generationError: error }; // Keep old content on failure, but clear dirty flag
                    dependencyErrorCache.set(snippet.name, error);
                    caughtError = error;
                }
                
                await saveSnippet(updatedSnippet);

                if (caughtError) {
                    dispatchEvent('snippet_regeneration_update', { name: snippet.name, status: 'failure', error: caughtError });
                } else {
                    dispatchEvent('snippet_regeneration_update', { name: snippet.name, status: 'success' });
                }
                
                await get().loadSnippets(); // Reload to ensure UI updates with the error or new content.

                set(state => {
                    const newRegenerating = state.regeneratingSnippetNames.filter(n => n !== snippet.name);
                    return { regeneratingSnippetNames: newRegenerating };
                });
            }

        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(error);
        } finally {
            set({ isRegenerating: false, regeneratingSnippetNames: [] });
            dispatchEvent('snippet_regeneration_completed');
        }
    },
});