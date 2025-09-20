import { setup, assign, SnapshotFrom, fromPromise, assertEvent } from 'xstate';
import { DisplayModelInfo } from '@/types/storage';
import { listAvailableModels } from '@/api/openrouter';
import { SettingsSnapshot, settingsMachine } from './settingsMachine';
import { ActorRefFrom } from 'xstate';

export type ModelsActorInput = {
    settingsActor: ActorRefFrom<typeof settingsMachine>;
};

export interface ModelsContext {
  cachedModels: DisplayModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
}

export type ModelsEvent =
  | { type: 'FETCH' }
  | { type: 'SETTINGS_UPDATE', snapshot: SettingsSnapshot }
  | { type: 'xstate.done.actor.fetchModels', output: DisplayModelInfo[] }
  | { type: 'xstate.error.actor.fetchModels', error: unknown };

export const modelsMachine = setup({
    types: {} as {
        context: ModelsContext,
        events: ModelsEvent,
        input: ModelsActorInput,
    },
    actors: {
        fetchModels: fromPromise(listAvailableModels),
    },
}).createMachine({
  id: 'models',
  initial: 'idle',
  context: () => ({
    cachedModels: [],
    modelsLoading: false,
    modelsError: null,
  }),
  states: {
    idle: {
      on: {
        FETCH: 'loading',
        SETTINGS_UPDATE: [
            {
                target: 'loading',
                guard: ({ event, context }) => {
                    const { apiKey } = event.snapshot.context;
                    const shouldLoad = !!apiKey && context.cachedModels.length === 0 && !context.modelsLoading;
                    console.log(`[DEBUG] modelsMachine: SETTINGS_UPDATE guard - apiKey: ${!!apiKey}, cachedModels: ${context.cachedModels.length}, loading: ${context.modelsLoading}, shouldLoad: ${shouldLoad}`);
                    return shouldLoad;
                },
            },
            {
                // If we get an API key but models are already loaded or loading, do nothing.
                guard: ({ event }) => !!event.snapshot.context.apiKey,
                actions: []
            }
        ]
      },
    },
    loading: {
      entry: assign({ modelsLoading: true, modelsError: null }),
      invoke: {
        id: 'fetchModels',
        src: 'fetchModels',
        onDone: {
          target: 'idle',
          actions: [
            assign({
                cachedModels: ({ event }): DisplayModelInfo[] => {
                  assertEvent(event, 'xstate.done.actor.fetchModels');
                  console.log('[DEBUG] modelsMachine: fetchModels.onDone, received models:', event.output);
                  return event.output;
                },
                modelsLoading: false,
            }),
          ],
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
