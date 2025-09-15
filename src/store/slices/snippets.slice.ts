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
        const { apiKey } = get();
        const allSnippets = get().snippets; // Always use fresh in-memory state
        console.debug(`[DEBUG] generateSnippetContent for '@${snippet.name}': Using snippets for prompt resolution:`, JSON.stringify(allSnippets.map(s => ({ name: s.name, content: s.content }))));
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

        const allSnippets = get().snippets;
        const dirtySnippetNames = allSnippets.filter(s => s.isDirty).map(s => s.name);

        if (dirtySnippetNames.length === 0) {
            return;
        }

        set({ isRegenerating: true, regeneratingSnippetNames: dirtySnippetNames });
        dispatchEvent('snippet_regeneration_started');

        try {
            const { sorted, cyclic } = topologicalSort(allSnippets);

            if (cyclic.length > 0) {
                const cycleError = `Snippet cycle detected: ${cyclic.join(', ')}. Please resolve the cycle to continue automatic regeneration.`;
                console.warn(`[STORE|processDirtySnippets] ${cycleError}`);
                get().setError(cycleError);
                // Even with a cycle, we can still attempt to process non-cyclic dirty snippets.
            }

            const dirtySnippets = sorted.filter(s => s.isDirty);
            console.debug(`[DEBUG] processDirtySnippets: Found dirty snippets to process: [${dirtySnippets.map(s => s.name).join(', ')}]`);

            if (dirtySnippets.length === 0) {
                set({ isRegenerating: false, regeneratingSnippetNames: [] });
                dispatchEvent('snippet_regeneration_completed');
                return;
            }

            const dependencyErrorCache = new Map<string, string | null>();

            const processSnippet = async (snippet: Snippet): Promise<void> => {
                let updatedSnippet: Snippet = { ...snippet };
                let caughtError: string | null = null;

                try {
                    if (!snippet.isGenerated) {
                        updatedSnippet.isDirty = false;
                    } else {
                        const dependencies = Array.from(getReferencedSnippetNames(snippet.prompt || ''));
                        const upstreamErrorDep = dependencies.find(dep => dependencyErrorCache.get(dep));
                        if (upstreamErrorDep) {
                            throw new Error(`Upstream dependency @${upstreamErrorDep} failed to generate.`);
                        }
                        const regenerated = await get().generateSnippetContent(snippet);
                        updatedSnippet = { ...regenerated, isDirty: false, generationError: null };
                        dependencyErrorCache.set(snippet.name, null);
                    }
                } catch (e) {
                    const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                    updatedSnippet = { ...snippet, isDirty: false, generationError: error };
                    dependencyErrorCache.set(snippet.name, error);
                    caughtError = error;
                }

                await saveSnippet(updatedSnippet);

                set(state => {
                    const newSnippets = state.snippets.map(s => s.name === updatedSnippet.name ? updatedSnippet : s);
                    const newRegenerating = state.regeneratingSnippetNames.filter(n => n !== snippet.name);
                    return { snippets: newSnippets, regeneratingSnippetNames: newRegenerating };
                });

                dispatchEvent('snippet_regeneration_update', {
                    name: snippet.name,
                    status: caughtError ? 'failure' : 'success',
                    error: caughtError,
                });
                console.debug(`[DEBUG] processDirtySnippets: Finished processing for '@${snippet.name}'.`);
            };

            let remainingDirtySnippets = get().snippets.filter(s => s.isDirty);
            let lastIterationCount = remainingDirtySnippets.length + 1;

            while (remainingDirtySnippets.length > 0 && remainingDirtySnippets.length < lastIterationCount) {
                lastIterationCount = remainingDirtySnippets.length;

                const batch = remainingDirtySnippets.filter(snippet => {
                    const dependencies = getReferencedSnippetNames(snippet.isGenerated ? snippet.prompt || '' : snippet.content);
                    return Array.from(dependencies).every(depName => {
                        const dependency = get().snippets.find(s => s.name === depName);
                        // A dependency is "ready" if it doesn't exist, isn't dirty, or is the snippet itself (for @-references in content)
                        return !dependency || !dependency.isDirty || dependency.name === snippet.name;
                    });
                });

                if (batch.length === 0) {
                    console.error('[STORE|processDirtySnippets] Stall detected. No snippets could be processed in this iteration. Remaining:', remainingDirtySnippets.map(s => s.name));
                    break;
                }

                await Promise.all(batch.map(processSnippet));

                // Re-fetch the state for the next iteration's condition
                remainingDirtySnippets = get().snippets.filter(s => s.isDirty);
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