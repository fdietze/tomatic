import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, SnippetsSlice } from '@/store/types';
import {
    deleteSnippet as dbDeleteSnippet,
    loadAllSnippets,
    saveSnippet,
    saveSnippets,
} from '@/services/db';
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
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to load snippets: ${error}`);
        }
    },
    addSnippet: async (snippet) => {
        console.log(`[STORE|addSnippet] called with`, snippet);
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

            await saveSnippet(snippetToSave);
            set(state => ({ snippets: [...state.snippets, snippetToSave] }));
            console.log(`[STORE|addSnippet] success`, snippetToSave);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.log(`[STORE|addSnippet] error`, error);
            get().setError(`Failed to add snippet: ${error}`);
            throw new Error(error);
        }
    },
    updateSnippet: async (oldName, snippet) => {
        console.log(`[STORE|updateSnippet] called with oldName: ${oldName}`, snippet);
        try {
            console.log(`[STORE|updateSnippet] Starting update for snippet: ${oldName}`);
            if (oldName !== snippet.name) {
                await dbDeleteSnippet(oldName);
            }
            const existingSnippet = get().snippets.find(s => s.name === oldName);
            const snippetToSave: Snippet = {
                ...snippet,
                createdAt_ms: existingSnippet?.createdAt_ms || Date.now(),
                updatedAt_ms: Date.now(),
                isDirty: existingSnippet?.isDirty || false,
                generationError: existingSnippet?.generationError || null
            };
            await saveSnippet(snippetToSave);
            set(state => ({
                snippets: state.snippets.map(s => s.name === oldName ? snippetToSave : s)
            }));
            await get()._markDependentsAsDirty(snippetToSave.name);
            console.log(`[STORE|updateSnippet] Finished update for snippet: ${snippet.name}`);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.log(`[STORE|updateSnippet] error`, error);
            get().setError(`Failed to update snippet: ${error}`);
            throw new Error(error);
        }
    },
    deleteSnippet: async (name) => {
        console.log(`[STORE|deleteSnippet] called with name: ${name}`);
        try {
            await dbDeleteSnippet(name);
            set(state => ({
                snippets: state.snippets.filter(s => s.name !== name)
            }));
            await get()._markDependentsAsDirty(name);
            console.log(`[STORE|deleteSnippet] success for name: ${name}`);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.log(`[STORE|deleteSnippet] error`, error);
            get().setError(`Failed to delete snippet: ${error}`);
            throw new Error(error);
        }
    },
    generateSnippetContent: async (snippet) => {
        const { apiKey, snippets: allSnippets } = get();
        if (!snippet.isGenerated || !snippet.prompt || !snippet.model || !apiKey) {
            const errorMessage = 'Snippet is not a valid generated snippet.';
            console.error(`[STORE|generateSnippetContent] for @${snippet.name}: ${errorMessage}`, snippet);
            throw new Error(errorMessage);
        }

        console.log(`[STORE|generateSnippetContent] Generating content for @${snippet.name}`);
        const resolvedPrompt = resolveSnippets(snippet.prompt, allSnippets);
        console.log(`[STORE|generateSnippetContent] Resolved prompt for @${snippet.name}: "${resolvedPrompt}"`);
        if (resolvedPrompt.trim() === '') {
            console.log(`[STORE|generateSnippetContent] Resolved prompt for @${snippet.name} is empty. Skipping generation.`);
            return { ...snippet, content: '' }; // Skip generation, return empty content
        }

        const messages: Message[] = [{ id: uuidv4(), role: 'user', content: resolvedPrompt }];
        
        try {
            const newContent = await requestMessageContent(messages, snippet.model, apiKey);
            console.log(`[STORE|generateSnippetContent] Successfully generated content for @${snippet.name}. New content: "${newContent}"`);
            return { ...snippet, content: newContent };
        } catch (e) {
            console.log(`[STORE|generateSnippetContent] CAUGHT ERROR for @${snippet.name} inside generateSnippetContent:`, e);
            // Re-throw the error to see if it's caught by the caller (processDirtySnippets)
            throw e;
        }
    },
    regenerateDependentSnippets: async () => {
        // This is a placeholder implementation to satisfy the type checker.
        // The actual implementation will be handled in a future task.
        return Promise.resolve();
    },
    _markDependentsAsDirty: async (changedSnippetName) => {
        console.log(`[STORE|_markDependentsAsDirty] ===== START for @${changedSnippetName} =====`);
        const { snippets } = get();
        const reverseGraph = buildReverseDependencyGraph(snippets);
        console.log(`[STORE|_markDependentsAsDirty] Reverse dependency graph:`, reverseGraph);
        const dependents = findTransitiveDependents(changedSnippetName, reverseGraph);

        if (dependents.size === 0) {
            console.log(`[STORE|_markDependentsAsDirty] Snippet @${changedSnippetName} has no dependents.`);
            console.log(`[STORE|_markDependentsAsDirty] ===== END for @${changedSnippetName} =====`);
            return;
        }
        console.log(`[STORE|_markDependentsAsDirty] Found dependents for @${changedSnippetName}:`, Array.from(dependents));

        const now = Date.now();
        const snippetsToSave = [...snippets];

        dependents.forEach(name => {
            const snippet = snippetsToSave.find(s => s.name === name);
            if (snippet) {
                snippet.isDirty = true;
                snippet.updatedAt_ms = now;
                console.log(`[STORE|_markDependentsAsDirty] Marked @${name} as dirty. Snippet state:`, JSON.parse(JSON.stringify(snippet)));
            }
        });

        try {
            await saveSnippets(snippetsToSave);
            console.log(`[STORE|_markDependentsAsDirty] Saved dirty snippets to DB.`);
            await get().loadSnippets();
            console.log(`[STORE|_markDependentsAsDirty] Reloaded snippets from DB. Current state:`, JSON.parse(JSON.stringify(get().snippets)));
            // Trigger regeneration asynchronously without waiting for it to complete
            void get().processDirtySnippets();
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.error(`[STORE|_markDependentsAsDirty] error`, error, e);
            get().setError(`Failed to mark dependent snippets as dirty: ${error}`);
        }
        console.log(`[STORE|_markDependentsAsDirty] ===== END for @${changedSnippetName} =====`);
    },
    processDirtySnippets: async () => {
         if (get().isRegenerating) {
            console.log('[STORE|processDirtySnippets] Regeneration already in progress. Skipping.');
            return;
        }

        set({ isRegenerating: true, regeneratingSnippetNames: [] });
        console.log('[STORE|processDirtySnippets] ===== START Regeneration Process =====');

        try {
            const allSnippets = await loadAllSnippets();
            console.log('[STORE|processDirtySnippets] Loaded all snippets from DB.', JSON.parse(JSON.stringify(allSnippets.map(s => ({ name: s.name, isDirty: s.isDirty, content: s.content, prompt: s.prompt })))));
            const { sorted, cyclic } = topologicalSort(allSnippets);

            console.log('[STORE|processDirtySnippets] Topological sort completed.');
            console.log('[STORE|processDirtySnippets] Sorted order:', sorted.map(s => s.name));
            console.log('[STORE|processDirtySnippets] Cyclic snippets:', cyclic);

            if (cyclic.length > 0) {
                const cycleError = `Snippet cycle detected: ${cyclic.join(', ')}. Please resolve the cycle to continue automatic regeneration.`;
                console.warn(`[STORE|processDirtySnippets] ${cycleError}`);
                get().setError(cycleError);
            }

            const dirtySnippets = sorted.filter(s => s.isDirty);

            if (dirtySnippets.length === 0) {
                console.debug('[STORE|processDirtySnippets] No dirty snippets to process. Exiting.');
                set({ isRegenerating: false });
                console.log('[STORE|processDirtySnippets] ===== END Regeneration Process (no dirty snippets) =====');
                return;
            }

            console.log('[STORE|processDirty_snippets] Dirty snippets to process (in order):', dirtySnippets.map(s => s.name));

            const dependencyErrorCache = new Map<string, string | null>();

            for (const snippet of dirtySnippets) {
                console.log(`[STORE|processDirtySnippets] ---> Processing dirty snippet: @${snippet.name}`, JSON.parse(JSON.stringify(snippet)));
                set(state => {
                    const newRegenerating = [...state.regeneratingSnippetNames, snippet.name];
                    console.log(`[STORE|processDirtySnippets] SET regeneratingSnippetNames: [${newRegenerating.join(', ')}]`);
                    return { regeneratingSnippetNames: newRegenerating };
                });

                let updatedSnippet: Snippet = { ...snippet };
                
                try {
                    const dependencies = Array.from(getReferencedSnippetNames(snippet.prompt || ''));
                    console.log(`[STORE|processDirtySnippets] Dependencies for @${snippet.name}: [${dependencies.join(', ')}]`);
                    console.log(`[STORE|processDirtySnippets] Current dependencyErrorCache:`, dependencyErrorCache);
                    const upstreamErrorDep = dependencies.find(dep => dependencyErrorCache.get(dep));
                    if (upstreamErrorDep) {
                        const errorMessage = `Upstream dependency @${upstreamErrorDep} failed to generate.`;
                        console.log(`[STORE|processDirtySnippets] Upstream dependency failed for @${snippet.name}. Error: ${errorMessage}`);
                        throw new Error(errorMessage);
                    }

                    const regenerated = await get().generateSnippetContent(snippet);
                    updatedSnippet = { ...regenerated, isDirty: false, generationError: null };
                    dependencyErrorCache.set(snippet.name, null);
                    console.log(`[STORE|processDirtySnippets] Successfully regenerated content for @${snippet.name}`);
                } catch (e) {
                    const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                    console.log(`[STORE|processDirtySnippets] CATCH BLOCK for @${snippet.name}. Full error object:`, e);
                    updatedSnippet = { ...snippet, isDirty: false, generationError: error }; // Keep old content on failure, but clear dirty flag
                    dependencyErrorCache.set(snippet.name, error);
                    console.log(`[STORE|processDirtySnippets] Updated dependencyErrorCache after failure of @${snippet.name}:`, dependencyErrorCache);
                }
                
                console.log(`[STORE|processDirtySnippets] Saving updated snippet for @${updatedSnippet.name}:`, JSON.parse(JSON.stringify(updatedSnippet)));
                await saveSnippet(updatedSnippet);
                await get().loadSnippets(); // Reload to ensure UI updates with the error or new content.
                console.log(`[STORE|processDirtySnippets] Reloaded all snippets after processing @${updatedSnippet.name}. Current state:`, JSON.parse(JSON.stringify(get().snippets)));

                set(state => {
                    const newRegenerating = state.regeneratingSnippetNames.filter(n => n !== snippet.name);
                    console.log(`[STORE|processDirtySnippets] SET regeneratingSnippetNames: [${newRegenerating.join(', ')}]`);
                    return { regeneratingSnippetNames: newRegenerating };
                });
                console.log(`[STORE|processDirtySnippets] <--- Finished processing @${snippet.name}`);
            }

        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.log('[STORE|processDirtySnippets] Unhandled exception in main try/catch block:', error, e);
            get().setError(error);
        } finally {
            console.log('[STORE|processDirtySnippets] ===== END Regeneration Process =====');
            set({ isRegenerating: false, regeneratingSnippetNames: [] });
        }
    },
});