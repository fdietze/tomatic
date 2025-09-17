import { setup, assign, SnapshotFrom, sendParent, fromPromise, ActorRefFrom, assertEvent } from 'xstate';
import { Snippet } from '@/types/storage';
import { loadAllSnippets, saveSnippet, deleteSnippet } from '@/services/db/snippets';
import { findTransitiveDependents, buildReverseDependencyGraph } from '@/utils/snippetUtils';
import { snippetRegenerationMachine } from './snippetRegenerationMachine';
import { settingsMachine } from './settingsMachine';
import { promptsMachine } from './promptsMachine';

// --- Context ---
export interface SnippetsContext {
  snippets: Snippet[];
  regeneratingSnippetNames: string[];
  error: string | null;
  regenerationActors: ActorRefFrom<typeof snippetRegenerationMachine>[];
  settingsActor: ActorRefFrom<typeof settingsMachine>;
  promptsActor: ActorRefFrom<typeof promptsMachine>;
  updatedSnippetNameForRegeneration: string | null;
}

// --- Events ---
export type SnippetsEvent =
  | { type: 'LOAD' }
  | { type: 'ADD'; snippet: Snippet }
  | { type: 'UPDATE'; oldName: string; snippet: Snippet }
  | { type: 'DELETE'; name: string }
  | { type: 'GENERATE_CONTENT'; name: string }
  | { type: 'SNIPPET_CONTENT_GENERATED', name: string }
  | { type: 'ACTOR_DONE'; output: { name: string, content?: string } }
  | { type: 'ACTOR_FAILED'; name: string }
  | { type: 'xstate.done.actor.loadSnippets'; output: Snippet[] }
  | { type: 'xstate.error.actor.loadSnippets'; error: Error }
  | { type: 'xstate.done.actor.addSnippet' }
  | { type: 'xstate.error.actor.addSnippet'; error: Error }
  | { type: 'xstate.done.actor.updateSnippet' }
  | { type: 'xstate.error.actor.updateSnippet'; error: Error }
  | { type: 'xstate.done.actor.deleteSnippet' }
  | { type: 'xstate.error.actor.deleteSnippet'; error: Error }
  | { type: 'xstate.done.actor.generateSnippetContent', output: { name: string, content: string } }
  | { type: 'xstate.error.actor.generateSnippetContent', error: unknown };


// --- Actor IO Types ---
type LoadSnippetsOutput = Snippet[];
type AddSnippetInput = { snippet: Snippet };
type UpdateSnippetInput = { oldName: string; snippet: Snippet };
type DeleteSnippetInput = { name: string };
type GenerateSnippetInput = { name: string };
type GenerateSnippetOutput = { name: string; content: string };

export interface SnippetsMachineInput {
    settingsActor: ActorRefFrom<typeof settingsMachine>;
    promptsActor: ActorRefFrom<typeof promptsMachine>;
}


export const snippetsMachine = setup({
    types: {} as {
        context: SnippetsContext,
        events: SnippetsEvent,
        input: SnippetsMachineInput,
    },
    actors: {
        loadSnippets: fromPromise<LoadSnippetsOutput, void>(loadAllSnippets),
        addSnippet: fromPromise<void, AddSnippetInput>(
            async ({ input }) => saveSnippet(input.snippet)
        ),
        updateSnippet: fromPromise<void, UpdateSnippetInput>(async ({ input }) => {
            if (input.oldName !== input.snippet.name) {
                await deleteSnippet(input.oldName);
            }
            await saveSnippet(input.snippet);
        }),
        deleteSnippet: fromPromise<void, DeleteSnippetInput>(
            async ({ input }) => deleteSnippet(input.name)
        ),
        generateSnippetContent: fromPromise<GenerateSnippetOutput, GenerateSnippetInput>(async ({ input }) => {
            // This is a placeholder for the actual implementation
            await new Promise(resolve => setTimeout(resolve, 1000));
            return { name: input.name, content: `Generated content for ${input.name}` };
        })
    },
    actions: {
        updateSnippetInList: assign({
            snippets: ({ context, event }) => {
                assertEvent(event, 'xstate.done.actor.generateSnippetContent');
                const { name, content } = event.output;
                return context.snippets.map((snippet) => 
                    snippet.name === name ? { ...snippet, content } : snippet
                );
            },
            regeneratingSnippetNames: ({ context, event }) => {
                assertEvent(event, 'xstate.done.actor.generateSnippetContent');
                const { name } = event.output;
                return context.regeneratingSnippetNames.filter((n) => n !== name);
            },
        }),
    },
}).createMachine({
  id: 'snippets',
  initial: 'loading',
  context: ({ input }) => ({
    snippets: [],
    regeneratingSnippetNames: [],
    error: null,
    regenerationActors: [],
    settingsActor: input.settingsActor,
    promptsActor: input.promptsActor,
    updatedSnippetNameForRegeneration: null,
  }),
  states: {
    loading: {
      invoke: {
        id: 'loadSnippets',
        src: 'loadSnippets',
        onDone: {
          target: 'idle',
          actions: assign({ snippets: ({ event }) => event.output }),
        },
        onError: {
          target: 'failure',
          actions: assign({ error: 'Failed to load snippets' }),
        },
      },
    },
    idle: {
      on: {
        LOAD: 'loading',
        ADD: {
          target: 'adding',
          actions: assign({
            snippets: ({ context, event }) => [...context.snippets, event.snippet],
          }),
        },
        UPDATE: {
          target: 'updating',
          actions: assign({
            snippets: ({ context, event }) => context.snippets.map(s => s.name === event.oldName ? event.snippet : s),
            updatedSnippetNameForRegeneration: ({ event }) => event.snippet.name,
          }),
        },
        DELETE: {
          target: 'deleting',
          actions: assign({
            snippets: ({ context, event }) => context.snippets.filter(s => s.name !== event.name),
          }),
        },
        GENERATE_CONTENT: { target: 'generating' },
      },
    },
    failure: {
        type: 'final'
    },
    adding: {
        invoke: {
            id: 'addSnippet',
            src: 'addSnippet',
            input: ({ event }) => {
                assertEvent(event, 'ADD');
                return { snippet: event.snippet };
            },
            onDone: 'idle',
            onError: {
                target: 'loading',
                actions: assign({ error: 'Failed to add snippet' }),
            }
        }
    },
    updating: {
        invoke: {
            id: 'updateSnippet',
            src: 'updateSnippet',
            input: ({ event }) => {
                assertEvent(event, 'UPDATE');
                const { oldName, snippet } = event;
                return { oldName, snippet };
            },
            onDone: {
                target: 'regenerating',
            },
            onError: {
                target: 'loading',
                actions: assign({ error: 'Failed to update snippet' }),
            }
        }
    },
    regenerating: {
        entry: assign({
            regenerationActors: ({ context, self, spawn }) => {
                const updatedSnippetName = context.updatedSnippetNameForRegeneration;
                if (!updatedSnippetName) return [];
                const updatedSnippet = context.snippets.find(s => s.name === updatedSnippetName);
                if (!updatedSnippet) return [];

                const reverseGraph = buildReverseDependencyGraph(context.snippets);
                const dependents = findTransitiveDependents(updatedSnippet.name, reverseGraph);
                console.log(`[DEBUG] snippetsMachine: Regenerating dependents for '${updatedSnippet.name}':`, Array.from(dependents));
                const actors = Array.from(dependents)
                    .map(depName => context.snippets.find(s => s.name === depName))
                    .filter((s): s is Snippet => !!s && s.isGenerated)
                    .map(snippet => spawn(snippetRegenerationMachine, {
                        input: {
                            snippet,
                            settings: context.settingsActor.getSnapshot().context,
                            allSnippets: context.snippets,
                            allSystemPrompts: context.promptsActor.getSnapshot().context.systemPrompts,
                            onDone: (output) => {
                                self.send({ type: 'ACTOR_DONE', output });
                            },
                            onError: (name) => {
                                self.send({ type: 'ACTOR_FAILED', name });
                            },
                        }
                    }));
                return actors;
            },
            updatedSnippetNameForRegeneration: null,
        }),
        on: {
            ACTOR_DONE: {
                actions: assign({
                    snippets: ({ context, event }) => {
                        assertEvent(event, 'ACTOR_DONE');
                        const { name, content } = event.output;
                        console.log(`[DEBUG] snippetsMachine: ACTOR_DONE for '${name}'. Received content: ${content ? content.slice(0, 50) + '...' : 'undefined'}`);
                        if (content) {
                            const updatedSnippets = context.snippets.map(s => s.name === name ? { ...s, content } : s);
                            console.log('[DEBUG] snippetsMachine: Snippets context updated.');
                            return updatedSnippets;
                        }
                        return context.snippets;
                    },
                    regenerationActors: ({ context, event }) => {
                        assertEvent(event, 'ACTOR_DONE');
                        return context.regenerationActors.filter(actor => actor.id !== event.output.name);
                    }
                }),
            },
            ACTOR_FAILED: {
                actions: assign({
                    error: 'Failed to regenerate snippets',
                    regenerationActors: ({ context, event }) => {
                        assertEvent(event, 'ACTOR_FAILED');
                        return context.regenerationActors.filter(actor => actor.id !== event.name);
                    }
                }),
            }
        },
        always: {
            target: 'idle',
            guard: ({ context }) => context.regenerationActors.length === 0,
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
            onDone: 'idle',
            onError: {
                target: 'loading',
                actions: assign({ error: 'Failed to delete snippet' }),
            }
        }
    },
    generating: {
        entry: assign({
            regeneratingSnippetNames: ({ context, event }) => [
                ...context.regeneratingSnippetNames, 
                (event as { type: 'GENERATE_CONTENT', name: string }).name
            ],
        }),
        invoke: {
            id: 'generateSnippetContent',
            src: 'generateSnippetContent',
            input: ({ event }) => {
                assertEvent(event, 'GENERATE_CONTENT');
                return { name: event.name };
            },
            onDone: {
                target: 'idle',
                actions: [
                    'updateSnippetInList',
                    sendParent(({ event }) => ({ 
                        type: 'SNIPPET_CONTENT_GENERATED', 
                        name: event.output.name 
                    })),
                ]
            },
            onError: {
                target: 'idle',
                actions: assign({
                    error: 'Failed to generate snippet content',
                    regeneratingSnippetNames: ({ event }) => {
                        // The input is not consistently available on the error event in XState v5
                        // We will need a more robust way to handle this, perhaps by passing the name in the event
                        // For now, we'll clear all regenerating names on failure to avoid a stuck spinner
                        console.error("Snippet regeneration failed:", event.error);
                        return [];
                    },
                }),
            }
        }
    }
  },
  on: {
      // No top-level event handlers needed for regeneration anymore
  }
});

export type SnippetsSnapshot = SnapshotFrom<typeof snippetsMachine>;
