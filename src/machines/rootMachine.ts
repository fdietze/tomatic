import {
    setup,
    assign,
    sendTo,
    ActorRefFrom,
    assertEvent,
    enqueueActions
} from 'xstate';
import { settingsMachine, SettingsSnapshot } from './settingsMachine';
import { promptsMachine, PromptsSnapshot } from './promptsMachine';
import { snippetsMachine, SnippetsSnapshot } from './snippetsMachine';
import { modelsMachine } from './modelsMachine';
import { sessionMachine } from './sessionMachine';

type RootMachineContext = {
    settingsActor?: ActorRefFrom<typeof settingsMachine>;
    promptsActor?: ActorRefFrom<typeof promptsMachine>;
    snippetsActor?: ActorRefFrom<typeof snippetsMachine>;
    modelsActor?: ActorRefFrom<typeof modelsMachine>;
    sessionActor?: ActorRefFrom<typeof sessionMachine>;
};

type RootMachineEvents = 
    | { type: 'SETTINGS_UPDATED', settings: SettingsSnapshot }
    | { type: 'URL_CHANGED', sessionId: string | null, queryParams: URLSearchParams, setSearchParams: (params: URLSearchParams) => void }
    | { type: 'PROMPTS_UPDATED', prompts: PromptsSnapshot }
    | { type: 'SNIPPETS_UPDATED', snippets: SnippetsSnapshot };

export const rootMachine = setup({
    types: {} as {
        context: RootMachineContext,
        events: RootMachineEvents,
    },
    actors: {
        settings: settingsMachine,
        prompts: promptsMachine,
        snippets: snippetsMachine,
        models: modelsMachine,
        session: sessionMachine,
    },
    actions: {
        assignActors: assign({
            settingsActor: ({ spawn }) => spawn('settings', { id: 'settings' }),
            promptsActor: ({ spawn }) => spawn('prompts', { id: 'prompts' }),
        }),
        assignDependentActors: assign({
            modelsActor: ({ spawn, context }) => spawn('models', {
                id: 'models',
                input: { settingsActor: context.settingsActor! }
            }),
            snippetsActor: ({ spawn, context }) => spawn('snippets', {
                id: 'snippets',
                input: {
                    promptsActor: context.promptsActor!,
                    settingsActor: context.settingsActor!
                }
            }),
        }),
        assignSessionActor: assign({
            sessionActor: ({ spawn, context }) => spawn('session', {
                id: 'session',
                input: {
                    settingsActor: context.settingsActor!,
                    promptsActor: context.promptsActor!,
                    snippetsActor: context.snippetsActor!
                }
            })
        }),
        forwardSettingsUpdate: enqueueActions(({ context, event, enqueue }) => {
            assertEvent(event, 'SETTINGS_UPDATED');
            console.log('[DEBUG] rootMachine: Received SETTINGS_UPDATED, forwarding to actors.');
            if (context.sessionActor) enqueue.sendTo(context.sessionActor, event);
            if (context.modelsActor) enqueue.sendTo(context.modelsActor, { type: 'SETTINGS_UPDATE', snapshot: event.settings });
        }),
        forwardPromptsUpdate: enqueueActions(({ context, event, enqueue }) => {
            assertEvent(event, 'PROMPTS_UPDATED');
            if (context.snippetsActor) enqueue.sendTo(context.snippetsActor, event);
        }),
        forwardSnippetsUpdate: enqueueActions(({ context, event, enqueue }) => {
            assertEvent(event, 'SNIPPETS_UPDATED');
            if (context.sessionActor) enqueue.sendTo(context.sessionActor, event);
        }),
    }
}).createMachine({
    id: 'root',
    initial: 'running',
    context: {
        settingsActor: undefined,
        promptsActor: undefined,
        snippetsActor: undefined,
        modelsActor: undefined,
        sessionActor: undefined,
    },
    states: {
        running: {
            entry: [
                'assignActors',
                'assignDependentActors',
                'assignSessionActor',
            ],
            on: {
                SETTINGS_UPDATED: {
                    actions: 'forwardSettingsUpdate',
                },
                PROMPTS_UPDATED: {
                    actions: 'forwardPromptsUpdate'
                },
                SNIPPETS_UPDATED: {
                    actions: 'forwardSnippetsUpdate'
                }
            }
        }
    }
});
