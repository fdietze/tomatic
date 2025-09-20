import { setup, assign, SnapshotFrom, ActorRefFrom, stop, sendTo, fromPromise, assertEvent, enqueueActions } from 'xstate';
import { Message } from '@/types/chat';
import * as db from '@/services/db';
import { NavigateFunction } from 'react-router-dom';
import { chatSubmissionMachine, ChatSubmissionInput } from '@/machines/chatSubmissionMachine';
import { settingsMachine, SettingsContext, SettingsSnapshot } from './settingsMachine';
import { promptsMachine, PromptsSnapshot } from './promptsMachine';
import { snippetsMachine, SnippetsSnapshot } from './snippetsMachine';
import { ChatSession } from '@/types/chat';

type ScrollEffect = { type: 'scrollToBottom' } | { type: 'scrollToLastUserMessage' } | null;

export type { ChatSubmissionInput };

export interface SessionContext {
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;
  error: string | null;
  submissionActor: ActorRefFrom<typeof chatSubmissionMachine> | null;
  scrollEffect: ScrollEffect;
  settingsActor: ActorRefFrom<typeof settingsMachine>;
  promptsActor: ActorRefFrom<typeof promptsMachine>;
  snippetsActor: ActorRefFrom<typeof snippetsMachine>;
  currentSettings: SettingsContext;
  currentPrompts: PromptsSnapshot['context'];
  currentSnippets: SnippetsSnapshot['context'];
  settingsReady: boolean;
  promptsReady: boolean;
  snippetsReady: boolean;
  pendingEvents: SessionEvent[];
}

export type SessionMachineInput = {
    settingsActor: ActorRefFrom<typeof settingsMachine>;
    promptsActor: ActorRefFrom<typeof promptsMachine>;
    snippetsActor: ActorRefFrom<typeof snippetsMachine>;
};

// Events now carry the full settings context they need
export type SessionEvent =
  | { type: 'LOAD_SESSION'; sessionId: string }
  | { type: 'START_NEW_SESSION' }
  | { 
      type: 'SUBMIT_USER_MESSAGE'; 
      message: string;
    }
  | { 
      type: 'REGENERATE'; 
      messageIndex: number;
    }
  | { 
      type: 'EDIT_MESSAGE'; 
      messageIndex: number; 
      newContent: string;
    }
  | { type: 'CANCEL' }
  | { type: 'SUBMISSION_ERROR'; error: string }
  | { type: 'SAVE_CURRENT_SESSION' }
  | { type: 'DELETE_SESSION'; sessionId: string; navigate: NavigateFunction }
  | { type: 'ADD_MESSAGE'; message: Message; autoScrollEnabled: boolean }
  | { type: 'UPDATE_MESSAGES'; messages: Message[]; autoScrollEnabled: boolean }
  | { type: 'SCROLL_EFFECT_CONSUMED' }
  | { type: 'SETTINGS_UPDATED', settings: SettingsSnapshot }
  | { type: 'PROMPTS_UPDATED', prompts: PromptsSnapshot }
  | { type: 'SNIPPETS_UPDATED', snippets: SnippetsSnapshot }
  | { type: 'xstate.done.actor.loadSession'; output: { messages: Message[], sessionId: string, prevId: string | null, nextId: string | null } }
  | { type: 'xstate.error.actor.loadSession', error: unknown }
  | { type: 'CHECK_READY' };

type LoadSessionInput = { sessionId: string };
export type LoadSessionOutput = { messages: Message[], sessionId: string, prevId: string | null, nextId: string | null };
type SaveSessionInput = { currentSessionId: string | null, messages: Message[] };

export const sessionMachine = setup({
    types: {
        context: {} as SessionContext,
        events: {} as SessionEvent,
        input: {} as SessionMachineInput,
    },
    actors: {
        loadSession: fromPromise<LoadSessionOutput, LoadSessionInput>(async ({ input }) => {
            const session = await db.loadSession(input.sessionId);
            if (!session) throw new Error("Session not found");
            const { prevId, nextId } = await db.findNeighbourSessionIds(session);
            return { messages: session.messages, prevId, nextId, sessionId: input.sessionId };
        }),
        saveSession: fromPromise<void, SaveSessionInput>(async ({ input }) => {
            if (input.currentSessionId) {
                const sessionToSave: Partial<ChatSession> = {
                    session_id: input.currentSessionId,
                    messages: input.messages,
                };
                await db.saveSession(sessionToSave as ChatSession);
            }
        }),
    },
    guards: {
      dependenciesReady: ({ context }) => context.settingsReady && context.promptsReady && context.snippetsReady,
    },
    actions: {
        spawnSubmitActor: assign({
            submissionActor: ({ spawn, context, event, self }) => {
                assertEvent(event, 'SUBMIT_USER_MESSAGE');
                
                const actorInput: ChatSubmissionInput = {
                    messages: context.messages,
                    apiKey: context.currentSettings.apiKey,
                    modelName: context.currentSettings.modelName,
                    systemPrompts: context.currentPrompts.systemPrompts,
                    snippets: context.currentSnippets.snippets,
                    selectedPromptName: context.currentSettings.selectedPromptName,
                    autoScrollEnabled: context.currentSettings.autoScrollEnabled,
                    onSuccess: (result) => self.send({ type: 'UPDATE_MESSAGES', ...result }),
                    onError: (error) => self.send({ type: 'SUBMISSION_ERROR', error }),
                };
                const actor = spawn(chatSubmissionMachine, { input: actorInput });
                actor.send({ type: 'SUBMIT', prompt: event.message });
                return actor;
            }
        }),
        spawnRegenerateActor: assign({
            submissionActor: ({ spawn, context, event, self }) => {
                assertEvent(event, 'REGENERATE');
                const messagesForResubmission = context.messages.slice(0, event.messageIndex);

                const actorInput: ChatSubmissionInput = {
                    messages: messagesForResubmission,
                    apiKey: context.currentSettings.apiKey,
                    modelName: context.currentSettings.modelName,
                    systemPrompts: context.currentPrompts.systemPrompts,
                    snippets: context.currentSnippets.snippets,
                    selectedPromptName: context.currentSettings.selectedPromptName,
                    autoScrollEnabled: context.currentSettings.autoScrollEnabled,
                    onSuccess: (result) => self.send({ type: 'UPDATE_MESSAGES', ...result }),
                    onError: (error) => self.send({ type: 'SUBMISSION_ERROR', error }),
                };

                const actor = spawn(chatSubmissionMachine, { input: actorInput });
                actor.send({ type: 'REGENERATE' });
                return actor;
            }
        }),
        spawnEditActor: assign({
            submissionActor: ({ spawn, context, event, self }) => {
                assertEvent(event, 'EDIT_MESSAGE');
                const messagesForResubmission = context.messages.slice(0, event.messageIndex);
                
                const actorInput: ChatSubmissionInput = {
                    messages: messagesForResubmission,
                    apiKey: context.currentSettings.apiKey,
                    modelName: context.currentSettings.modelName,
                    systemPrompts: context.currentPrompts.systemPrompts,
                    snippets: context.currentSnippets.snippets,
                    selectedPromptName: context.currentSettings.selectedPromptName,
                    autoScrollEnabled: context.currentSettings.autoScrollEnabled,
                    onSuccess: (result) => self.send({ type: 'UPDATE_MESSAGES', ...result }),
                    onError: (error) => self.send({ type: 'SUBMISSION_ERROR', error }),
                };

                const actor = spawn(chatSubmissionMachine, { input: actorInput });
                actor.send({ type: 'SUBMIT', prompt: event.newContent });
                return actor;
            }
        }),
        processPendingEvents: enqueueActions(({ context, enqueue }) => {
            context.pendingEvents.forEach(evt => {
                assertEvent(evt, ['SUBMIT_USER_MESSAGE', 'REGENERATE', 'EDIT_MESSAGE']);
                enqueue.raise(evt);
            });
            enqueue.assign({ pendingEvents: [] });
        }),
        signalReadyForTests: () => {
            if (window.__IS_TESTING__) {
                window.sessionReady = true;
            }
        },
    }
}).createMachine({
  id: 'session',
  initial: 'waitingForDependencies',
  context: ({ input }) => {
    return {
        messages: [],
        currentSessionId: null,
        prevSessionId: null,
        nextSessionId: null,
        error: null,
        submissionActor: null,
        scrollEffect: null,
        settingsActor: input.settingsActor,
        promptsActor: input.promptsActor,
        snippetsActor: input.snippetsActor,
        currentSettings: {
            apiKey: '',
            modelName: '',
            autoScrollEnabled: true,
            initialChatPrompt: null,
            input: '',
            isInitializing: true,
            selectedPromptName: null,
            error: null,
        },
        currentPrompts: {
            systemPrompts: [],
            error: null,
            promptsLoaded: false,
        },
        currentSnippets: {
            snippets: [],
            error: null,
            promptsActor: input.promptsActor,
            settingsActor: input.settingsActor,
            regeneratingSnippetNames: [],
            _currentUpdate: null,
            currentSettings: {
                apiKey: '',
                modelName: '',
                autoScrollEnabled: true,
                initialChatPrompt: null,
                input: '',
                isInitializing: true,
                selectedPromptName: null,
                error: null,
            },
            currentPrompts: {
                systemPrompts: [],
                error: null,
                promptsLoaded: false,
            },
        },
        settingsReady: false,
        promptsReady: false,
        snippetsReady: false,
        pendingEvents: [],
    };
  },
  on: {
    SETTINGS_UPDATED: {
        actions: [
            assign({ currentSettings: ({ event }) => event.settings.context, settingsReady: true }),
            sendTo(({ self }) => self, { type: 'CHECK_READY' }),
        ],
    },
    PROMPTS_UPDATED: {
        actions: [
            assign({ currentPrompts: ({ event }) => event.prompts.context, promptsReady: true }),
            sendTo(({ self }) => self, { type: 'CHECK_READY' }),
        ],
    },
    SNIPPETS_UPDATED: {
        actions: [
            assign({ currentSnippets: ({ event }) => event.snippets.context, snippetsReady: true }),
            sendTo(({ self }) => self, { type: 'CHECK_READY' }),
        ],
    },
  },
  states: {
    waitingForDependencies: {
        after: {
          10000: {
            target: 'timeout',
            actions: assign({ error: 'Dependencies timeout' })
          }
        },
        always: {
            target: 'idle',
            guard: ({ context }) => 
                context.settingsReady && 
                context.promptsReady && 
                context.snippetsReady,
        },
        on: {
          '*': {
            actions: assign({
              pendingEvents: ({ context, event }) => {
                if (event.type === 'SUBMIT_USER_MESSAGE' || event.type === 'REGENERATE' || event.type === 'EDIT_MESSAGE') {
                  return [...context.pendingEvents, event];
                }
                return context.pendingEvents; // Ignore others
              }
            })
          },
          CHECK_READY: { /* no-op, just to trigger always re-evaluation */ },
        }
    },
    idle: {
        entry: ['processPendingEvents', 'signalReadyForTests'],
        on: {
            LOAD_SESSION: 'loading',
            START_NEW_SESSION: {
                actions: assign({
                    messages: [],
                    currentSessionId: null,
                    prevSessionId: null,
                    nextSessionId: null,
                    error: null
                })
            },
            SUBMIT_USER_MESSAGE: {
                target: 'processingSubmission',
                guard: 'dependenciesReady',
                actions: [
                    'spawnSubmitActor',
                    sendTo(({ context }) => context.settingsActor, ({ event }) => ({ type: 'SET_INPUT', text: event.message })),
                ],
            },
            REGENERATE: {
                target: 'processingSubmission',
                guard: 'dependenciesReady',
                actions: 'spawnRegenerateActor',
            },
            EDIT_MESSAGE: {
                target: 'processingSubmission',
                guard: 'dependenciesReady',
                actions: 'spawnEditActor',
            },
        }
    },
    processingSubmission: {
        entry: () => {
        },
        exit: () => {
        },
        on: {
            CANCEL: {
                target: 'idle',
                actions: [
                    stop(({ context }) => context.submissionActor!),
                    assign({
                        submissionActor: null,
                    }),
                    ({ context }) => {
                        context.submissionActor?.send({ type: 'CANCEL' });
                    }
                ]
            },
            UPDATE_MESSAGES: {
                target: 'idle',
                actions: [
                    stop(({ context }) => context.submissionActor!),
                    assign({
                        messages: ({ event }) => event.messages,
                        scrollEffect: ({ event }) => {
                            if (event.autoScrollEnabled) return { type: 'scrollToBottom' };
                            const lastMessage = event.messages[event.messages.length - 1];
                            if (lastMessage?.role === 'user') return { type: 'scrollToLastUserMessage' };
                            return null;
                        },
                        submissionActor: null
                    }),
                ],
            },
            SUBMISSION_ERROR: {
                target: 'idle',
                actions: [
                    stop(({ context }) => context.submissionActor!),
                    assign({
                        error: ({ event }) => event.error,
                        submissionActor: null,
                    })
                ]
            },
        }
    },
    loading: {
      invoke: {
        id: 'loadSession',
        src: 'loadSession',
        input: ({ event }) => {
            assertEvent(event, 'LOAD_SESSION');
            return { sessionId: event.sessionId };
        },
        onDone: {
          target: 'idle',
          actions: assign({
                messages: ({ event }) => {
                    assertEvent(event, 'xstate.done.actor.loadSession');
                    return event.output.messages;
                },
                currentSessionId: ({ event }) => {
                    assertEvent(event, 'xstate.done.actor.loadSession');
                    return event.output.sessionId;
                },
                prevSessionId: ({ event }) => {
                    assertEvent(event, 'xstate.done.actor.loadSession');
                    return event.output.prevId;
                },
                nextSessionId: ({ event }) => {
                    assertEvent(event, 'xstate.done.actor.loadSession');
                    return event.output.nextId;
                },
                scrollEffect: { type: 'scrollToBottom' },
            }),
        },
        onError: {
          target: 'idle',
          actions: assign({ error: 'Failed to load session' }),
        },
      },
    },
    timeout: { type: 'final' },
  },
});

export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;
