import { setup, assign, SnapshotFrom, fromPromise, assertEvent } from 'xstate';
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
  | { type: 'xstate.done.actor.loadSettings', output: Partial<SettingsContext> }
  | { type: 'xstate.error.actor.loadSettings', error: unknown };

export const settingsMachine = setup({
  types: {} as {
    context: SettingsContext,
    events: SettingsEvent,
  },
  actors: {
    loadSettings: fromPromise<Partial<SettingsContext>, void>(() => Promise.resolve(loadSettings())),
  },
  actions: {
    saveSettings: ({ context }) => {
      saveSettings(context);
    },
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
      invoke: {
        id: 'loadSettings',
        src: 'loadSettings',
        onDone: {
          target: 'idle',
          actions: assign(( { event }) => {
            assertEvent(event, 'xstate.done.actor.loadSettings');
            const loaded = event.output;
            return {
                ...loaded,
                isInitializing: false,
                error: null,
            };
          })
        },
        onError: {
          target: 'failure',
          actions: assign({
            isInitializing: false,
            error: 'Failed to load settings',
          }),
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
        'saveSettings',
      ],
    },
    SET_MODEL_NAME: {
      actions: [
        assign({ modelName: ({ event }) => event.name }),
        'saveSettings',
      ]
    },
    SET_INPUT: {
      actions: assign({ input: ({ event }) => event.text }),
    },
    SET_SELECTED_PROMPT_NAME: {
      actions: [
        assign({ selectedPromptName: ({ event }) => event.name }),
        'saveSettings',
      ]
    },
    TOGGLE_AUTO_SCROLL: {
      actions: [
        assign({ autoScrollEnabled: ({ context }) => !context.autoScrollEnabled }),
        'saveSettings',
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
