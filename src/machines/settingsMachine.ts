import { setup, assign, SnapshotFrom, fromPromise, DoneActorEvent } from 'xstate';
import { loadSettings, saveSettings } from '@/services/persistence/settings';

// The context should hold all the state from the SettingsSlice and UtilitySlice
export interface SettingsContext {
  apiKey: string;
  modelName: string;
  input: string;
  selectedPromptName: string | null;
  autoScrollEnabled: boolean;
  error: string | null;
  isInitializing: boolean;
  initialChatPrompt: string | null;
}

// The events are the actions that can be dispatched to the machine
export type SettingsEvent =
  | { type: 'SET_API_KEY'; key: string }
  | { type: 'SET_MODEL_NAME'; name: string }
  | { type: 'SET_INPUT'; text: string }
  | { type: 'SET_SELECTED_PROMPT_NAME'; name: string | null }
  | { type: 'TOGGLE_AUTO_SCROLL' }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_INITIAL_CHAT_PROMPT'; prompt: string | null }
  | { type: 'INIT' }
  | { type: 'xstate.done.actor.loadSettings', output: Partial<SettingsContext> };

export const settingsMachine = setup({
  types: {
    context: {} as SettingsContext,
    events: {} as SettingsEvent,
  },
}).createMachine({
  id: 'settings',
  initial: 'loading',
  context: {
    apiKey: '',
    modelName: 'openai/gpt-4o',
    input: '',
    selectedPromptName: null,
    autoScrollEnabled: true,
    error: null,
    isInitializing: true,
    initialChatPrompt: null,
  },
  states: {
    loading: {
        entry: () => { console.log('[DEBUG] settingsMachine: entered loading state.'); },
        invoke: {
            id: 'loadSettings',
            src: fromPromise<Partial<SettingsContext>>(() => loadSettings()),
            onDone: {
                target: 'idle',
                actions: assign(({ context, event }: { context: SettingsContext, event: DoneActorEvent<Partial<SettingsContext>> }) => {
                    const loaded = event.output;
                    console.log('[DEBUG] settingsMachine: loadSettings.onDone, assigning context:', loaded);
                    const newContext: SettingsContext = {
                        ...context,
                        ...loaded,
                        isInitializing: false,
                        error: null,
                    };
                    console.log('[DEBUG] settingsMachine: final context after assignment:', newContext);
                    return newContext;
                })
            },
            onError: {
                target: 'failure',
                actions: [
                    assign({
                        isInitializing: false,
                        error: 'Failed to load settings',
                    }),
                    ({ event }): void => { console.error('[DEBUG] settingsMachine: loadSettings.onError', (event as { error: Error }).error); },
                ]
            }
        }
    },
    failure: {
        type: 'final'
    },
    idle: {}
  },
  on: {
    SET_API_KEY: {
      actions: [
        assign({ apiKey: ({ event }) => event.key }),
        ({ context }): void => { saveSettings(context); },
        (): void => { console.log('[DEBUG] settingsMachine: API key set.'); },
      ],
    },
    SET_MODEL_NAME: {
      actions: [
        assign({ modelName: ({ event }) => event.name }),
        ({ context }): void => { saveSettings(context); },
      ]
    },
    SET_INPUT: {
      actions: assign({ input: ({ event }) => event.text }),
    },
    SET_SELECTED_PROMPT_NAME: {
      actions: [
        assign({ selectedPromptName: ({ event }) => event.name }),
        ({ context }): void => { saveSettings(context); },
      ]
    },
    TOGGLE_AUTO_SCROLL: {
      actions: [
        assign({ autoScrollEnabled: ({ context }) => !context.autoScrollEnabled }),
        ({ context }): void => { saveSettings(context); },
      ]
    },
    SET_ERROR: {
      actions: assign({ error: ({ event }) => event.error }),
    },
    SET_INITIAL_CHAT_PROMPT: {
        actions: assign({ initialChatPrompt: ({ event }) => event.prompt }),
    },
  },
});

export type SettingsSnapshot = SnapshotFrom<typeof settingsMachine>;
