import { setup, assign, SnapshotFrom, fromPromise, assertEvent, sendParent } from 'xstate';
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
  | { type: 'xstate.error.actor.loadSettings', error: unknown }
  | { type: 'xstate.done.actor.saveSettings', output: SettingsContext }
  | { type: 'xstate.error.actor.saveSettings', error: unknown };

export const settingsMachine = setup({
  types: {} as {
    context: SettingsContext,
    events: SettingsEvent,
  },
  actors: {
    loadSettings: fromPromise<Partial<SettingsContext>, void>(() => Promise.resolve(loadSettings())),
    saveSettings: fromPromise(async ({ input }: { input: SettingsContext }) => {
        saveSettings(input);
        return input;
    }),
  },
  actions: {
    notifyParent: ({ self, context }) => {
      const parent = self.system?.get('#_parent');
      if (parent) {
        parent.send({ type: 'SETTINGS_UPDATED', settings: { context } });
      } else {
        console.log('[DEBUG] settingsMachine: notifyParent skipped - no valid parent.');
      }
    },
    persistSettings: ({ context }) => saveSettings(context),
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
          actions: [
            assign({
              apiKey: ({ event }) => {
                assertEvent(event, 'xstate.done.actor.loadSettings');
                console.log('[DEBUG] settingsMachine: loadSettings.onDone, loaded apiKey:', event.output.apiKey);
                return event.output.apiKey || '';
              },
              modelName: ({ event }) => {
                assertEvent(event, 'xstate.done.actor.loadSettings');
                console.log('[DEBUG] settingsMachine: loadSettings.onDone, loaded modelName:', event.output.modelName);
                return event.output.modelName || 'openai/gpt-4o';
              },
              autoScrollEnabled: ({ event }) => {
                assertEvent(event, 'xstate.done.actor.loadSettings');
                console.log('[DEBUG] settingsMachine: loadSettings.onDone, loaded autoScrollEnabled:', event.output.autoScrollEnabled);
                return event.output.autoScrollEnabled ?? true;
              },
              selectedPromptName: ({ event }) => {
                assertEvent(event, 'xstate.done.actor.loadSettings');
                console.log('[DEBUG] settingsMachine: loadSettings.onDone, loaded selectedPromptName:', event.output.selectedPromptName);
                return event.output.selectedPromptName || null;
              },
              initialChatPrompt: ({ event }) => {
                assertEvent(event, 'xstate.done.actor.loadSettings');
                console.log('[DEBUG] settingsMachine: loadSettings.onDone, loaded initialChatPrompt:', event.output.initialChatPrompt);
                return event.output.initialChatPrompt || null;
              },
              isInitializing: false,
            }),
            'notifyParent',
          ],
        },
        onError: {
          target: 'failure',
          actions: assign({
            error: ({ event }) => {
              console.log('[DEBUG] settingsMachine: loadSettings.onError, event:', event);
              return 'Failed to load settings';
            },
            isInitializing: false,
          }),
        },
      },
    },
    failure: {
        type: 'final'
    },
    idle: {
        on: {
            SET_API_KEY: { 
                actions: [
                    assign({ apiKey: ({ event }) => event.key }),
                    'persistSettings',
                ], 
                target: 'saving' 
            },
            SET_MODEL_NAME: { 
                actions: [
                    assign({ modelName: ({ event }) => event.name }),
                    'persistSettings',
                ], 
                target: 'saving' 
            },
            SET_SELECTED_PROMPT_NAME: { 
                actions: [
                    assign({ selectedPromptName: ({ event }) => event.name }),
                    'persistSettings',
                ], 
                target: 'saving' 
            },
            TOGGLE_AUTO_SCROLL: {
                actions: [
                    assign({ autoScrollEnabled: ({ context }) => !context.autoScrollEnabled }),
                    'persistSettings',
                ],
                target: 'saving'
            },
            SET_INPUT: { 
                actions: assign({ input: ({ event }) => event.text }),
            },
            SET_ERROR: { 
                actions: assign({ error: ({ event }) => event.error }),
            },
            SET_INITIAL_CHAT_PROMPT: {
                actions: [
                    assign({ initialChatPrompt: ({ event }) => event.prompt }),
                    'persistSettings',
                ],
                target: 'saving'
            },
        }
    },
    saving: {
      invoke: {
        id: 'saveSettings',
        src: 'saveSettings',
        input: ({ context }) => context,
        onDone: {
            target: 'idle',
            actions: 'notifyParent',
        },
        onError: {
            target: 'idle',
            actions: assign({ error: 'Failed to save settings' })
        }
      }
    }
  },
});

export type SettingsSnapshot = SnapshotFrom<typeof settingsMachine>;
