import { setup, assign, SnapshotFrom, fromPromise, assertEvent } from 'xstate';
import { SystemPrompt } from '@/types/storage';
import { 
    loadAllSystemPrompts,
    saveSystemPrompt,
    deleteSystemPrompt
} from '@/services/db/system-prompts';

export interface PromptsContext {
  systemPrompts: SystemPrompt[];
  error: string | null;
  promptsLoaded: boolean;
}

export type PromptsEvent =
  | { type: 'LOAD' }
  | { type: 'ADD'; prompt: SystemPrompt }
  | { type: 'UPDATE'; oldName: string; prompt: SystemPrompt }
  | { type: 'DELETE'; name: string }
  | { type: 'xstate.done.actor.loadPrompts', output: SystemPrompt[] }
  | { type: 'xstate.error.actor.loadPrompts', error: unknown }
  | { type: 'xstate.done.actor.addPrompt' }
  | { type: 'xstate.error.actor.addPrompt', error: unknown }
  | { type: 'xstate.done.actor.updatePrompt' }
  | { type: 'xstate.error.actor.updatePrompt', error: unknown }
  | { type: 'xstate.done.actor.deletePrompt' }
  | { type: 'xstate.error.actor.deletePrompt', error: unknown };


export const promptsMachine = setup({
    types: {} as {
        context: PromptsContext,
        events: PromptsEvent,
    },
    actors: {
        loadSystemPrompts: fromPromise(loadAllSystemPrompts),
        addPrompt: fromPromise(async ({ input }: { input: SystemPrompt }) => {
            await saveSystemPrompt(input);
        }),
        updatePrompt: fromPromise(async ({ input }: { input: { oldName: string, prompt: SystemPrompt }}) => {
            // NOTE: The DB API uses a simple `put` operation. We must delete the old prompt first
            // if its name (the primary key) has changed.
            if (input.oldName !== input.prompt.name) {
                await deleteSystemPrompt(input.oldName);
            }
            await saveSystemPrompt(input.prompt);
        }),
        deletePrompt: fromPromise(async ({ input }: { input: string }) => {
            await deleteSystemPrompt(input);
        }),
    }
}).createMachine({
  id: 'prompts',
  initial: 'loading',
  context: {
    systemPrompts: [],
    error: null,
    promptsLoaded: false,
  },
  states: {
    loading: {
      invoke: {
        id: 'loadPrompts',
        src: 'loadSystemPrompts',
        onDone: {
          target: 'idle',
          actions: assign({
            systemPrompts: ({ event }) => event.output,
            promptsLoaded: true,
          }),
        },
        onError: {
          target: 'failure',
          actions: [
            assign({ error: 'Failed to load system prompts' }),
            ({ event }): void => { 
                assertEvent(event, 'xstate.error.actor.loadPrompts');
                console.error('[DEBUG] promptsMachine loadPrompts onError', event.error); 
            }
            ],
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
            systemPrompts: ({ context, event }) => [...context.systemPrompts, event.prompt],
          })
        },
        UPDATE: {
          target: 'updating',
          actions: assign({
            systemPrompts: ({ context, event }) => context.systemPrompts.map(p => p.name === event.oldName ? event.prompt : p),
          })
        },
        DELETE: {
          target: 'deleting',
          actions: assign({
            systemPrompts: ({ context, event }) => context.systemPrompts.filter(p => p.name !== event.name),
          })
        },
      },
    },
    adding: {
        invoke: {
            id: 'addPrompt',
            src: 'addPrompt',
            input: ({ event }) => {
                assertEvent(event, 'ADD');
                return event.prompt;
            },
            onDone: 'idle',
            onError: {
                target: 'loading', // On error, refetch to revert optimistic update
                actions: assign({ error: 'Failed to add prompt' }),
            }
        }
    },
    updating: {
        invoke: {
            id: 'updatePrompt',
            src: 'updatePrompt',
            input: ({ event }) => {
                assertEvent(event, 'UPDATE');
                const updateEvent = event;
                return { oldName: updateEvent.oldName, prompt: updateEvent.prompt };
            },
            onDone: 'idle',
            onError: {
                target: 'loading', // On error, refetch to revert optimistic update
                actions: assign({ error: 'Failed to update prompt' }),
            }
        }
    },
    deleting: {
        invoke: {
            id: 'deletePrompt',
            src: 'deletePrompt',
            input: ({ event }) => {
                assertEvent(event, 'DELETE');
                return event.name;
            },
            onDone: 'idle',
            onError: {
                target: 'loading', // On error, refetch to revert optimistic update
                actions: assign({ error: 'Failed to delete prompt' }),
            }
        }
    },
    failure: {
        type: 'final'
    }
  },
});

export type PromptsSnapshot = SnapshotFrom<typeof promptsMachine>;
