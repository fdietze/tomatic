import { setup, assign, SnapshotFrom, fromPromise, assertEvent } from 'xstate';
import { DisplayModelInfo } from '@/types/storage';
import { listAvailableModels } from '@/api/openrouter';

export interface ModelsContext {
  cachedModels: DisplayModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
}

export type ModelsEvent =
  | { type: 'FETCH' }
  | { type: 'xstate.done.actor.fetchModels', output: DisplayModelInfo[] }
  | { type: 'xstate.error.actor.fetchModels', error: unknown };

export const modelsMachine = setup({
    types: {} as {
        context: ModelsContext,
        events: ModelsEvent,
    },
    actors: {
        fetchModels: fromPromise(listAvailableModels),
    },
}).createMachine({
  id: 'models',
  initial: 'idle',
  context: {
    cachedModels: [],
    modelsLoading: false,
    modelsError: null,
  } as ModelsContext,
  states: {
    idle: {
      on: {
        FETCH: 'loading',
      },
    },
    loading: {
      entry: assign({ modelsLoading: true, modelsError: null }),
      invoke: {
        id: 'fetchModels',
        src: 'fetchModels',
        onDone: {
          target: 'idle',
          actions: assign({
            cachedModels: ({ event }): DisplayModelInfo[] => {
              assertEvent(event, 'xstate.done.actor.fetchModels');
              console.log('[DEBUG] modelsMachine: fetchModels.onDone, received models:', event.output);
              return event.output;
            },
            modelsLoading: false,
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            modelsError: 'Failed to fetch models',
            modelsLoading: false,
          }),
        },
      },
    },
  },
});

export type ModelsSnapshot = SnapshotFrom<typeof modelsMachine>;
