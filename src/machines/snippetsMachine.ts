import { setup, assign, SnapshotFrom, sendParent, fromPromise } from 'xstate';
import { Snippet } from '@/types/storage';
import {
    loadAllSnippets,
    saveSnippet,
    deleteSnippet,
} from '@/services/db/snippets';
import { chatSubmissionMachine } from './chatSubmissionMachine';
import { ActorRefFrom } from 'xstate';

export interface SnippetsContext {
  snippets: Snippet[];
  isRegenerating: boolean;
  regeneratingSnippetNames: string[];
  error: string | null;
  generationActor: ActorRefFrom<typeof chatSubmissionMachine> | null;
}

export type SnippetsEvent =
  | { type: 'LOAD' }
  | { type: 'ADD'; snippet: Snippet }
  | { type: 'UPDATE'; oldName: string; snippet: Snippet }
  | { type: 'DELETE'; name: string }
  | { type: 'GENERATE_CONTENT'; name: string }
  | { type: 'xstate.done.actor.loadSnippets'; output: Snippet[] }
  | { type: 'xstate.error.actor.loadSnippets'; error: Error }
  | { type: 'xstate.done.actor.addSnippet' }
  | { type: 'xstate.error.actor.addSnippet'; error: Error }
  | { type: 'xstate.done.actor.updateSnippet' }
  | { type: 'xstate.error.actor.updateSnippet'; error: Error }
  | { type: 'xstate.done.actor.deleteSnippet' }
  | { type: 'xstate.error.actor.deleteSnippet'; error: Error }
  | { type: 'xstate.done.actor.generateSnippetContent', output: { name: string, content: string } };

type LoadSnippetsDoneEvent = Extract<SnippetsEvent, { type: 'xstate.done.actor.loadSnippets' }>;
type AddSnippetEvent = Extract<SnippetsEvent, { type: 'ADD' }>;
type UpdateSnippetEvent = Extract<SnippetsEvent, { type: 'UPDATE' }>;
type DeleteSnippetEvent = Extract<SnippetsEvent, { type: 'DELETE' }>;
type GenerateSnippetContentEvent = Extract<SnippetsEvent, { type: 'GENERATE_CONTENT' }>;
type GenerateSnippetContentDoneEvent = Extract<SnippetsEvent, { type: 'xstate.done.actor.generateSnippetContent' }>;
type GenerateSnippetContentErrorEvent = { type: 'xstate.error.actor.generateSnippetContent', error: unknown, __brand: "GenerateSnippetContentErrorEvent" };

export const snippetsMachine = setup({
    types: {
        context: {} as SnippetsContext,
        events: {} as SnippetsEvent,
    },
    actions: {
        updateSnippetInList: assign({
            snippets: ({ context, event }) => {
                const { name, content } = (event as GenerateSnippetContentDoneEvent).output;
                return context.snippets.map((snippet) => {
                    if (snippet.name === name) {
                        return { ...snippet, content };
                    }
                    return snippet;
                });
            },
            regeneratingSnippetNames: ({ context, event }) => context.regeneratingSnippetNames.filter((n) => n !== (event as GenerateSnippetContentDoneEvent).output.name),
        }),
    },
    actors: {
        loadSnippets: fromPromise(loadAllSnippets),
        addSnippet: fromPromise(async ({ input }: { input: Snippet }) => {
            await saveSnippet(input);
        }),
        updateSnippet: fromPromise(async ({ input }: { input: { oldName: string, snippet: Snippet }}) => {
            if (input.oldName !== input.snippet.name) {
                await deleteSnippet(input.oldName);
            }
            await saveSnippet(input.snippet);
        }),
        deleteSnippet: fromPromise(async ({ input }: { input: string }) => {
            await deleteSnippet(input);
        }),
        generateSnippetContent: fromPromise(async ({ input }: { input: { name: string } }) => {
            // This is a placeholder for the actual implementation
            await new Promise(resolve => setTimeout(resolve, 1000));
            return { name: input.name, content: `Generated content for ${input.name}` };
        })
    }
}).createMachine({
  id: 'snippets',
  initial: 'loading',
  context: {
    snippets: [],
    isRegenerating: false,
    regeneratingSnippetNames: [],
    error: null,
    generationActor: null,
  },
  states: {
    loading: {
      invoke: {
        id: 'loadSnippets',
        src: 'loadSnippets',
        onDone: {
          target: 'idle',
          actions: assign({ snippets: ({ event }) => (event as LoadSnippetsDoneEvent).output }),
        },
        onError: {
          target: 'failure',
          actions: assign({ error: 'Failed to load snippets' }),
        },
      },
    },
    idle: {
      on: {
        LOAD: {
            target: 'loading',
        },
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
            input: ({ event }) => (event as AddSnippetEvent).snippet,
            onDone: 'idle',
            onError: {
                target: 'loading', // On error, refetch to revert optimistic update
                actions: assign({ error: 'Failed to add snippet' }),
            }
        }
    },
    updating: {
        invoke: {
            id: 'updateSnippet',
            src: 'updateSnippet',
            input: ({ event }) => ({ oldName: (event as UpdateSnippetEvent).oldName, snippet: (event as UpdateSnippetEvent).snippet }),
            onDone: 'idle',
            onError: {
                target: 'loading', // On error, refetch to revert optimistic update
                actions: assign({ error: 'Failed to update snippet' }),
            }
        }
    },
    deleting: {
        invoke: {
            id: 'deleteSnippet',
            src: 'deleteSnippet',
            input: ({ event }) => (event as DeleteSnippetEvent).name,
            onDone: 'idle',
            onError: {
                target: 'loading', // On error, refetch to revert optimistic update
                actions: assign({ error: 'Failed to delete snippet' }),
            }
        }
    },
    generating: {
        entry: assign({
            regeneratingSnippetNames: ({ context, event }) => [...context.regeneratingSnippetNames, (event as GenerateSnippetContentEvent).name],
        }),
        invoke: {
            id: 'generateSnippetContent',
            src: 'generateSnippetContent',
            input: ({ event }) => ({ name: (event as GenerateSnippetContentEvent).name }),
            onDone: {
                target: 'idle',
                actions: [
                    'updateSnippetInList',
                    sendParent(({ event }) => ({ type: 'SNIPPET_CONTENT_GENERATED', name: (event as GenerateSnippetContentDoneEvent).output.name })),
                ]
            },
            onError: {
                target: 'idle',
                actions: assign({
                    error: 'Failed to generate snippet content',
                    regeneratingSnippetNames: ({ context, event }) => {
                        const errorEvent = event as unknown as GenerateSnippetContentErrorEvent;
                        // This is a bit of a hack to get the input from the error event
                        // A better solution would be to have XState provide this directly
                        const name = (errorEvent.error as { data: { input: { name: string } } }).data.input.name;
                        return context.regeneratingSnippetNames.filter(n => n !== name);
                    },
                }),
            }
        }
    }
  },
});

export type SnippetsSnapshot = SnapshotFrom<typeof snippetsMachine>;
