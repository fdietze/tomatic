import { setup, assign, SnapshotFrom, fromPromise, ActorRefFrom, assertEvent, EmittedFrom, sendParent, enqueueActions, sendTo } from 'xstate';
import { Snippet } from '@/types/storage';
import { loadAllSnippets, saveSnippet, deleteSnippet } from '@/services/db/snippets';
import { findTransitiveDependents, buildReverseDependencyGraph } from '@/utils/snippetUtils';
import { snippetRegenerationMachine, SnippetRegenerationEmitted, SnippetRegenerationInput } from './snippetRegenerationMachine';
import { settingsMachine, SettingsContext, SettingsSnapshot } from './settingsMachine';
import { promptsMachine, PromptsSnapshot } from './promptsMachine';

// --- Machine Types ---

export type SnippetsMachineContext = {
    snippets: Snippet[];
    error: string | null;
    promptsActor: ActorRefFrom<typeof promptsMachine>;
    settingsActor: ActorRefFrom<typeof settingsMachine>;
    regeneratingSnippetNames: string[];
    _currentUpdate: { oldName: string, snippet: Snippet } | null;
    currentSettings: SettingsContext;
    currentPrompts: PromptsSnapshot['context'];
};

export type SnippetsMachineInput = {
    promptsActor: ActorRefFrom<typeof promptsMachine>;
    settingsActor: ActorRefFrom<typeof settingsMachine>;
};

export type AllSnippetsMachineEvents =
  | { type: 'LOAD' }
  | { type: 'ADD'; snippet: Snippet }
  | { 
      type: 'UPDATE'; 
      oldName: string; 
      snippet: Snippet;
    }
  | { type: 'DELETE'; name: string }
  | { type: 'GENERATE_CONTENT', name: string }
  | { type: 'SETTINGS_UPDATED', settings: SettingsSnapshot }
  | { type: 'PROMPTS_UPDATED', prompts: PromptsSnapshot }
  | { type: 'xstate.done.actor.loadSnippets', output: Snippet[] }
  | { type: 'xstate.error.actor.loadSnippets', error: unknown }
  | { type: 'xstate.done.actor.addSnippet', output: Snippet }
  | { type: 'xstate.error.actor.addSnippet', error: unknown }
  | { type: 'xstate.done.actor.updater', output: Snippet }
  | { type: 'xstate.error.actor.updater', error: unknown }
  | { type: 'xstate.done.actor.deleteSnippet', output: string }
  | { type: 'xstate.error.actor.deleteSnippet', error: unknown }
  | { type: 'xstate.done.actor', output: Snippet, actorId: string }
  | { type: 'xstate.error.actor', error: unknown, actorId: string }
  | { type: 'REGENERATION_CHECK' }
  | { type: 'xstate.done.actor.regenerateSnippet', output: Snippet }
  | SnippetRegenerationEmitted;


export type SnippetsSnapshot = SnapshotFrom<typeof snippetsMachine>;
export type SnippetsActor = EmittedFrom<typeof snippetsMachine>;
export type { SnippetsMachineContext as SnippetsContext };

// --- Machine Definition ---

export const snippetsMachine = setup({
    types: {
        context: {} as SnippetsMachineContext,
        events: {} as AllSnippetsMachineEvents,
        input: {} as SnippetsMachineInput,
    },
    actors: {
        loadSnippets: fromPromise<Snippet[], void>(async () => loadAllSnippets()),
        addSnippet: fromPromise<Snippet, { snippet: Snippet }>(async ({ input }) => {
            await saveSnippet(input.snippet);
            return input.snippet;
        }),
        updateSnippet: fromPromise<Snippet, { oldName: string, snippet: Snippet }>(async ({ input }) => {
            if (input.oldName !== input.snippet.name) {
                await deleteSnippet(input.oldName);
            }
            await saveSnippet(input.snippet);
            return input.snippet;
        }),
        deleteSnippet: fromPromise<string, { name: string }>(async ({ input }) => {
            await deleteSnippet(input.name);
            return input.name;
        }),
        regenerateSnippet: snippetRegenerationMachine,
    },
    actions: {
        updateSnippetInContext: assign({
            snippets: ({ context, event }) => {
                if (event.type === 'xstate.done.actor.updater') {
                    const updatedSnippet = event.output;
                    const nameToFind = context._currentUpdate!.oldName;
                    return context.snippets.map(s => {
                        if (s.name === nameToFind) {
                            return { ...s, ...updatedSnippet };
                        }
                        return s;
                    });
                }
                if ('actorId' in event && 'output' in event && event.type.startsWith('xstate.done.actor') && event.actorId.startsWith('regenerator-')) {
                    const { name, content } = event.output;
                    return context.snippets.map(s => {
                        if (s.name === name) {
                            return { ...s, content };
                        }
                        return s;
                    });
                }
                return context.snippets;
            },
        }),
        addSnippetToContext: assign({
            snippets: ({ context, event }) => {
                assertEvent(event, 'xstate.done.actor.addSnippet');
                return [...context.snippets, event.output];
            }
        }),
        removeSnippetFromContext: assign({
            snippets: ({ context, event }) => {
                assertEvent(event, 'xstate.done.actor.deleteSnippet');
                return context.snippets.filter(s => s.name !== event.output);
            }
        }),
        spawnRegenerationActors: assign({
            regeneratingSnippetNames: ({ context }) => {
                if (!context._currentUpdate) return [];
                const { snippet: updatedSnippet } = context._currentUpdate;
                const reverseGraph = buildReverseDependencyGraph(context.snippets);
                const dependents = findTransitiveDependents(updatedSnippet.name, reverseGraph);
                // eslint-disable-next-line no-console
                console.log('[DEBUG] spawnRegenerationActors', {
                    updatedSnippetName: updatedSnippet.name,
                    snippetCount: context.snippets.length,
                    reverseGraphKeys: Object.keys(reverseGraph),
                    dependents: Array.from(dependents),
                });
                return Array.from(dependents)
                    .map(depName => context.snippets.find(s => s.name === depName))
                    .filter((s): s is Snippet => !!s && s.isGenerated)
                    .map(s => s.name);
            },
        }),
        spawnActorsFromNames: enqueueActions(({ context, enqueue }) => {
            const settings = context.currentSettings;
            const systemPrompts = context.currentPrompts.systemPrompts;

            // eslint-disable-next-line no-console
            console.log('[DEBUG] spawnActorsFromNames entry', { names: context.regeneratingSnippetNames });
            context.regeneratingSnippetNames.forEach(snippetName => {
                const snippet = context.snippets.find(s => s.name === snippetName);
                if (snippet && snippet.isGenerated) {
                    const actorInput: SnippetRegenerationInput = {
                        snippet,
                        settings,
                        allSnippets: context.snippets,
                        allSystemPrompts: systemPrompts,
                    };
                    // eslint-disable-next-line no-console
                    console.log('[DEBUG] spawning child', { id: `regenerator-${snippet.name}` });
                    enqueue.spawnChild('regenerateSnippet', {
                        id: `regenerator-${snippet.name}`,
                        input: actorInput,
                    });
                }
            });
        }),
        clearCurrentUpdate: assign({
            _currentUpdate: null
        }),
        clearCompletedActorName: assign({
            regeneratingSnippetNames: ({ context, event }) => {
                if ('actorId' in event && typeof event.actorId === 'string' && event.actorId.startsWith('regenerator-')) {
                    const name = event.actorId.replace('regenerator-', '');
                    return context.regeneratingSnippetNames.filter(n => n !== name);
                }
                return context.regeneratingSnippetNames;
            }
        }),
        notifyParent: sendParent(({ context }) => ({
            type: 'SNIPPETS_UPDATED',
            snippets: { context }
        })),
    },
}).createMachine({
  id: 'snippets',
  initial: 'loading',
  context: ({ input }) => ({
    snippets: [],
    error: null,
    promptsActor: input.promptsActor,
    settingsActor: input.settingsActor,
    regeneratingSnippetNames: [],
    _currentUpdate: null,
    currentSettings: {
        apiKey: '',
        modelName: '',
        autoScrollEnabled: true,
        initialChatPrompt: null,
        input: '',
        isInitializing: true,
        selectedPromptName: null,
        error: null,
    },
    currentPrompts: {
        systemPrompts: [],
        error: null,
        promptsLoaded: false,
    },
  }),
  on: {
    SETTINGS_UPDATED: {
        actions: assign({ currentSettings: ({ event }) => event.settings.context }),
    },
    PROMPTS_UPDATED: {
        actions: assign({ currentPrompts: ({ event }) => event.prompts.context }),
    },
  },
  states: {
    loading: {
      invoke: {
        id: 'loadSnippets',
        src: 'loadSnippets',
        onDone: {
          target: 'idle',
          actions: [
            assign({
                snippets: ({ event }) => event.output,
            }),
            ({ context, event }) => {
              console.log('[DEBUG] snippetsMachine: loading.onDone - sending to parent. Context:', context, 'Event:', event);
              sendParent({ type: 'SNIPPETS_UPDATED', snippets: { context } });
            }
          ],
        },
        onError: {
          target: 'failure',
          actions: assign({ error: 'Failed to load snippets' }),
        },
      },
    },
    idle: {
      on: {
        ADD: 'adding',
        UPDATE: 'updating',
        DELETE: 'deleting',
        GENERATE_CONTENT: 'generatingContent',
      },
    },
    adding: {
      invoke: {
        id: 'addSnippet',
        src: 'addSnippet',
        input: ({ event }) => {
            assertEvent(event, 'ADD');
            return { snippet: event.snippet };
        },
        onDone: {
          target: 'idle',
          actions: [
            assign({
                snippets: ({ context, event }) => {
                    const doneEvent = event as unknown as { type: 'xstate.done.actor.addSnippet', output: Snippet };
                    return [...context.snippets, doneEvent.output];
                }
            }),
            ({ context, event }) => {
              console.log('[DEBUG] snippetsMachine: saving.onDone - sending to parent. Context:', context, 'Event:', event);
              sendParent({ type: 'SNIPPETS_UPDATED', snippets: { context } });
            }
        ]
        },
        onError: {
          target: 'failure',
          actions: assign({ error: 'Failed to add snippet' }),
        },
      },
    },
    updating: {
        entry: assign({
            _currentUpdate: ({ event }) => {
                assertEvent(event, 'UPDATE');
                return { oldName: event.oldName, snippet: event.snippet };
            }
        }),
        invoke: {
            id: 'updater',
            src: 'updateSnippet',
            input: ({ event }) => {
                assertEvent(event, 'UPDATE');
                return { oldName: event.oldName, snippet: event.snippet };
            },
            onDone: {
                target: 'calculatingDependencies',
                actions: assign({
                    snippets: ({ context, event }) => {
                        assertEvent(event, 'xstate.done.actor.updater');
                        const updatedSnippet = event.output;
                        const nameToFind = context._currentUpdate!.oldName;
                        return context.snippets.map(s => s.name === nameToFind ? updatedSnippet : s);
                    },
                })
            },
            onError: {
                target: 'failure',
                actions: assign({ error: 'Failed to update snippet' }),
            },
        },
    },
    calculatingDependencies: {
        entry: [
            // eslint-disable-next-line no-console
            () => console.log('[DEBUG] entering calculatingDependencies'),
            'spawnRegenerationActors',
            'spawnActorsFromNames',
            'clearCurrentUpdate',
            'notifyParent'
        ],
        on: {
            'xstate.done.actor': {
                actions: ({ event }) => {
                    // eslint-disable-next-line no-console
                    console.log('[DEBUG] "xstate.done.actor" received while in calculatingDependencies for actor:', (event as { actorId?: string }).actorId);
                }
            },
            'xstate.error.actor': {
                actions: ({ event }) => {
                    // eslint-disable-next-line no-console
                    console.log('[DEBUG] "xstate.error.actor" received while in calculatingDependencies for actor:', (event as { actorId?: string }).actorId);
                }
            }
        },
        always: 'regenerating'
    },
    regenerating: {
        entry: [
            // eslint-disable-next-line no-console
            () => console.log('[DEBUG] entering regenerating'),
            'notifyParent', // Notify UI that regeneration has started
            sendTo(({ self }) => self, { type: 'REGENERATION_CHECK' }),
        ],
        on: {
            'snippet.regeneration.done': {
                actions: enqueueActions(({ context, event, self, enqueue }) => {
                    // Update content for the completed snippet
                    const { name, content } = event as unknown as { type: 'snippet.regeneration.done'; name: string; content?: string | null };
                    const updatedSnippets = context.snippets.map(s => s.name === name ? { ...s, content: content ?? '' } : s);
                    enqueue.assign({ snippets: updatedSnippets });
                    // Remove from pending list
                    const newNames = context.regeneratingSnippetNames.filter(n => n !== name);
                    // eslint-disable-next-line no-console
                    console.log('[DEBUG] snippet.regeneration.done', { name, before: context.regeneratingSnippetNames, after: newNames });
                    enqueue.assign({ regeneratingSnippetNames: newNames });
                    enqueue('notifyParent');
                    enqueue.sendTo(self, { type: 'REGENERATION_CHECK' });
                })
            },
            'snippet.regeneration.error': {
                actions: enqueueActions(({ context, event, self, enqueue }) => {
                    const { name, error } = event as unknown as { type: 'snippet.regeneration.error'; name: string; error?: string | null };
                    const updatedSnippets = context.snippets.map(s => s.name === name ? { ...s, generationError: error ?? 'Unknown error' } : s);
                    enqueue.assign({ snippets: updatedSnippets });
                    const newNames = context.regeneratingSnippetNames.filter(n => n !== name);
                    // eslint-disable-next-line no-console
                    console.log('[DEBUG] snippet.regeneration.error', { name, before: context.regeneratingSnippetNames, after: newNames });
                    enqueue.assign({ regeneratingSnippetNames: newNames });
                    enqueue('notifyParent');
                    enqueue.sendTo(self, { type: 'REGENERATION_CHECK' });
                })
            },
            'xstate.done.actor': {
                actions: enqueueActions(({ context, event, self, enqueue }) => {
                    assertEvent(event, 'xstate.done.actor');
                    console.log('[DEBUG] "xstate.done.actor" received in regenerating state for actor:', (event as { actorId: string }).actorId);
                    console.log('[DEBUG] regeneratingSnippetNames before processing:', JSON.stringify(context.regeneratingSnippetNames));

                    // 1. Update snippets content
                    const { name, content } = event.output as { name: string, content: string | null };
                    const updatedSnippets = context.snippets.map(s => s.name === name ? { ...s, content: content || '' } : s);
                    enqueue.assign({ snippets: updatedSnippets });
                    
                    // 2. Update the list of regenerating names
                    const actorId = (event as { actorId: string }).actorId;
                    if (actorId.startsWith('regenerator-')) {
                        const actorName = actorId.replace('regenerator-', '');
                        const newRegeneratingNames = context.regeneratingSnippetNames.filter((n: string) => n !== actorName);
                        console.log('[DEBUG] Calculated new regeneratingSnippetNames:', JSON.stringify(newRegeneratingNames));
                        enqueue.assign({ regeneratingSnippetNames: newRegeneratingNames });
                    }

                    // 3. Notify parent and check for completion
                    enqueue('notifyParent');
                    enqueue.sendTo(self, { type: 'REGENERATION_CHECK' });
                })
            },
            'xstate.error.actor': {
                actions: enqueueActions(({ context, event, self, enqueue }) => {
                    // 1. Update the list of regenerating names
                    const actorId = (event as { actorId: string }).actorId;
                    console.log('[DEBUG] "xstate.error.actor" received in regenerating state for actor:', actorId);
                    console.log('[DEBUG] regeneratingSnippetNames before error processing:', JSON.stringify(context.regeneratingSnippetNames));
                    if (actorId.startsWith('regenerator-')) {
                        const actorName = actorId.replace('regenerator-', '');
                        const newRegeneratingNames = context.regeneratingSnippetNames.filter((n: string) => n !== actorName);
                        console.log('[DEBUG] Calculated new regeneratingSnippetNames after error:', JSON.stringify(newRegeneratingNames));
                        enqueue.assign({ regeneratingSnippetNames: newRegeneratingNames });
                    }
                    // TODO: Handle error reporting in UI

                    // 2. Check for completion
                    enqueue.sendTo(self, { type: 'REGENERATION_CHECK' });
                }),
            },
            REGENERATION_CHECK: {
                target: 'idle',
                guard: ({ context }) => {
                    const guardResult = context.regeneratingSnippetNames.length === 0;
                    console.log(`[DEBUG] REGENERATION_CHECK guard. Names left: ${context.regeneratingSnippetNames.length}. Names: ${JSON.stringify(context.regeneratingSnippetNames)}. Will transition to idle: ${guardResult}`);
                    return guardResult;
                },
            },
        },
    },
    deleting: {
      invoke: {
        id: 'deleteSnippet',
        src: 'deleteSnippet',
        input: ({ event }) => {
            assertEvent(event, 'DELETE');
            return { name: event.name };
        },
        onDone: {
          target: 'idle',
          actions: [
            assign({
                snippets: ({ context, event }) => {
                    const doneEvent = event as unknown as { type: 'xstate.done.actor.deleteSnippet', output: string };
                    return context.snippets.filter(s => s.name !== doneEvent.output);
                }
            }),
            'notifyParent'
        ]
        },
        onError: {
          target: 'failure',
          actions: assign({ error: 'Failed to delete snippet' }),
        },
      },
    },
    generatingContent: {
        invoke: {
            src: 'regenerateSnippet',
            input: ({ context, event }) => {
                assertEvent(event, 'GENERATE_CONTENT');
                const snippet = context.snippets.find(s => s.name === event.name);
                if (!snippet) { 
                    throw new Error(`Snippet '${event.name}' not found for single regeneration.`);
                }
                return {
                    snippet,
                    settings: context.currentSettings,
                    allSystemPrompts: context.currentPrompts.systemPrompts,
                    allSnippets: context.snippets
                };
            },
            onDone: {
                target: 'idle',
                actions: [
                    assign({
                        snippets: ({ context, event }) => {
                            const doneEvent = event as unknown as { type: 'xstate.done.actor.regenerateSnippet', output: Snippet };
                            const output = doneEvent.output;
                            return context.snippets.map(s => s.name === output.name ? { ...s, content: output.content } : s);
                        }
                    }),
                    'notifyParent'
                ]
            },
            onError: {
                target: 'failure',
                actions: assign({ error: 'Failed to generate content' }),
            }
        }
    },
    failure: {
      on: {
        LOAD: 'loading',
      },
    },
  },
});
