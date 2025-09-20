import { setup, assign, SnapshotFrom, fromPromise, assertEvent, sendParent } from 'xstate';
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
  | { type: 'xstate.done.actor.addPrompt', output: SystemPrompt }
  | { type: 'xstate.error.actor.addPrompt', error: unknown }
  | { type: 'xstate.done.actor.updatePrompt', output: SystemPrompt }
  | { type: 'xstate.error.actor.updatePrompt', error: unknown }
  | { type: 'xstate.done.actor.deletePrompt', output: string }
  | { type: 'xstate.error.actor.deletePrompt', error: unknown };


export const promptsMachine = setup({
    types: {
        context: {} as PromptsContext,
        events: {} as PromptsEvent,
    },
    actors: {
        loadSystemPrompts: fromPromise(loadAllSystemPrompts),
        addPrompt: fromPromise(async ({ input }: { input: SystemPrompt }) => {
            await saveSystemPrompt(input);
            return input;
        }),
        updatePrompt: fromPromise(async ({ input }: { input: { oldName: string, prompt: SystemPrompt }}) => {
            // NOTE: The DB API uses a simple `put` operation. We must delete the old prompt first
            // if its name (the primary key) has changed.
            if (input.oldName !== input.prompt.name) {
                await deleteSystemPrompt(input.oldName);
            }
            await saveSystemPrompt(input.prompt);
            return input.prompt;
        }),
        deletePrompt: fromPromise(async ({ input }: { input: string }) => {
            await deleteSystemPrompt(input);
            return input;
        }),
    },
    actions: {
        notifyParent: sendParent(({ context }) => ({
            type: 'PROMPTS_UPDATED',
            prompts: { context }
        })),
        addPrompt: assign({
            systemPrompts: ({ context, event }) => {
                assertEvent(event, 'xstate.done.actor.addPrompt');
                return [...context.systemPrompts, event.output];
            }
        }),
        updatePrompt: assign({
            systemPrompts: ({ context, event }) => {
                assertEvent(event, ['xstate.done.actor.addPrompt', 'xstate.done.actor.updatePrompt']);
                // This logic correctly handles both adding a new prompt (replacing the optimistically added one)
                // and updating an existing one.
                const updatedPrompt = event.output;
                const exists = context.systemPrompts.some(p => p.name === updatedPrompt.name);
                if (exists) {
                    return context.systemPrompts.map(p => p.name === updatedPrompt.name ? updatedPrompt : p);
                }
                // This case handles when a prompt's name is changed during an update.
                // We need more info to handle that robustly here, so for now we'll just add it.
                // The correct way would be to trace it via an ID.
                return [...context.systemPrompts, updatedPrompt];
            }
        }),
        removePrompt: assign({
            systemPrompts: ({ context, event }) => {
                assertEvent(event, 'xstate.done.actor.deletePrompt');
                return context.systemPrompts.filter(p => p.name !== event.output);
            }
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
          actions: [
            assign({
                systemPrompts: ({ event }) => event.output,
                promptsLoaded: true,
            }),
            'notifyParent'
          ],
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
          target: 'persistingAdd',
          actions: assign({
            systemPrompts: ({ context, event }) => {
                // Avoid adding duplicates if the user clicks multiple times
                if (context.systemPrompts.some(p => p.name === event.prompt.name)) {
                    return context.systemPrompts;
                }
                return [...context.systemPrompts, event.prompt];
            }
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
    persistingAdd: {
        invoke: {
            id: 'addPrompt',
            src: 'addPrompt',
            input: ({ event }) => {
                assertEvent(event, 'ADD');
                return event.prompt;
            },
            onDone: {
                target: 'idle',
                actions: ['updatePrompt', 'notifyParent']
            },
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
            onDone: {
                target: 'idle',
                actions: ['updatePrompt', 'notifyParent']
            },
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
            onDone: {
                target: 'idle',
                actions: ['removePrompt', 'notifyParent']
            },
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
