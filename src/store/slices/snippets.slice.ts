import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, SnippetsSlice } from '@/store/types';
import {
    deleteSnippet as dbDeleteSnippet,
    loadAllSnippets,
    saveSnippet,
    saveSnippets,
} from '@/services/persistence';
import { Message } from '@/types/chat';
import { requestMessageContentStreamed } from '@/api/openrouter';
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
        try {
            const now = Date.now();
            const snippetToSave: Snippet = {
                ...snippet,
                createdAt_ms: now,
                updatedAt_ms: now,
                generationError: null,
                isDirty: false
            };
            await saveSnippet(snippetToSave);
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
            const existingSnippet = get().snippets.find(s => s.name === oldName);
            const snippetToSave: Snippet = {
                ...snippet,
                createdAt_ms: existingSnippet?.createdAt_ms || Date.now(),
                updatedAt_ms: Date.now(),
                isDirty: existingSnippet?.isDirty || false,
                generationError: existingSnippet?.generationError || null
            };
            await saveSnippet(snippetToSave);
            await get().loadSnippets();
            await get()._markDependentsAsDirty(oldName);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to update snippet: ${error}`);
        }
    },
    deleteSnippet: async (name) => {
        try {
            await dbDeleteSnippet(name);
            await get().loadSnippets();
            await get()._markDependentsAsDirty(name);
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
    _markDependentsAsDirty: async (changedSnippetName) => {
        const { snippets } = get();
        const reverseGraph = buildReverseDependencyGraph(snippets);
        const dependents = findTransitiveDependents(changedSnippetName, reverseGraph);

        if (dependents.size === 0) return;

        console.debug(`[STORE|_markDependentsAsDirty] Marking ${String(dependents.size)} snippets as dirty due to change in @${changedSnippetName}:`, Array.from(dependents));

        const now = Date.now();
        const dirtySnippets = snippets
            .filter(s => dependents.has(s.name))
            .map(s => ({ ...s, isDirty: true, updatedAt_ms: now }));
        
        try {
            await saveSnippets(dirtySnippets);
            await get().loadSnippets();
            // Trigger regeneration asynchronously without waiting for it to complete
            void get().processDirtySnippets();
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(`Failed to mark dependent snippets as dirty: ${error}`);
        }
    },
    processDirtySnippets: async () => {
        if (get().isRegenerating) return;

        set({ isRegenerating: true, regeneratingSnippetNames: [] });
        console.debug('[STORE|processDirtySnippets] Starting regeneration process.');

        try {
            const allSnippets = await loadAllSnippets();
            const { sorted, cyclic } = topologicalSort(allSnippets);
            
            if (cyclic.length > 0) {
              console.warn(`[STORE|processDirtySnippets] Cycles detected involving snippets: ${cyclic.join(', ')}. These snippets will be skipped.`);
            }

            const dirtySnippets = sorted.filter(s => s.isDirty);

            if (dirtySnippets.length === 0) {
                console.debug('[STORE|processDirtySnippets] No dirty snippets to process.');
                set({ isRegenerating: false });
                return;
            }

            console.debug(`[STORE|processDirtySnippets] Found ${String(dirtySnippets.length)} dirty snippets to process in order:`, dirtySnippets.map(s => s.name));

            const dependencyErrorCache = new Map<string, string | null>();

            for (const snippet of dirtySnippets) {
                set(state => ({ regeneratingSnippetNames: [...state.regeneratingSnippetNames, snippet.name] }));

                let updatedSnippet: Snippet = { ...snippet };
                let errorOccurred = false;
                
                try {
                    // Pre-check for upstream errors
                    const dependencies = Array.from(getReferencedSnippetNames(snippet.prompt || ''));
                    const upstreamError = dependencies.find(dep => dependencyErrorCache.get(dep));
                    if (upstreamError) {
                        throw new Error(`Upstream dependency @${upstreamError} failed to generate.`);
                    }

                    const regenerated = await get().generateSnippetContent(snippet);
                    updatedSnippet = { ...regenerated, isDirty: false, generationError: null };
                    dependencyErrorCache.set(snippet.name, null);

                } catch (e) {
                    const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                    console.error(`[STORE|processDirtySnippets] Failed to regenerate @${snippet.name}:`, error);
                    updatedSnippet = { ...snippet, isDirty: true, generationError: error };
                    dependencyErrorCache.set(snippet.name, error);
                    errorOccurred = true;
                }
                
                await saveSnippet(updatedSnippet);
                await get().loadSnippets(); // Reload to ensure next snippet has latest data
                set(state => ({ regeneratingSnippetNames: state.regeneratingSnippetNames.filter(n => n !== snippet.name) }));

                if(errorOccurred) {
                    // If this snippet failed, we don't proceed to its dependents in this run.
                    // The topological sort ensures we've already processed its dependencies.
                }
            }

        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            console.error('[STORE|processDirtySnippets] A critical error occurred during the regeneration process:', error);
            get().setError(error);
        } finally {
            console.debug('[STORE|processDirtySnippets] Regeneration process finished.');
            set({ isRegenerating: false, regeneratingSnippetNames: [] });
        }
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