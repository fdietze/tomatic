import { setup, assign, SnapshotFrom, fromPromise, DoneActorEvent } from 'xstate';
import { DisplayModelInfo } from '@/types/storage';
import { listAvailableModels } from '@/api/openrouter';

export interface ModelsContext {
  cachedModels: DisplayModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
}

export type ModelsEvent =
  | { type: 'FETCH' }
  | { type: 'xstate.done.actor.fetchModels', output: DisplayModelInfo[] };

export const modelsMachine = setup({
    types: {
        context: {} as ModelsContext,
        events: {} as ModelsEvent,
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
        src: fromPromise(listAvailableModels),
        onDone: {
          target: 'idle',
          actions: 
            assign({
              cachedModels: ({ event }: { event: DoneActorEvent<DisplayModelInfo[]> }) => event.output,
              modelsLoading: false,
            }),
        },
        onError: {
          target: 'idle',
          actions: 
            assign({
              modelsError: 'Failed to fetch models',
              modelsLoading: false,
            }),
        },
      },
    },
  },
});

export type ModelsSnapshot = SnapshotFrom<typeof modelsMachine>;
