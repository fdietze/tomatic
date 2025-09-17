import { setup, assign, SnapshotFrom, ActorRefFrom, stop, sendTo, fromPromise, assertEvent } from 'xstate';
import { Message } from '@/types/chat';
import * as db from '@/services/db';
import { NavigateFunction } from 'react-router-dom';
import { chatSubmissionMachine, ChatSubmissionInput } from '@/machines/chatSubmissionMachine';
import { settingsMachine, SettingsContext } from './settingsMachine';
import { promptsMachine, PromptsContext } from './promptsMachine';
import { snippetsMachine, SnippetsContext } from './snippetsMachine';
import { ChatSession } from '@/types/chat';

type ScrollEffect = { type: 'scrollToBottom' } | { type: 'scrollToLastUserMessage' } | null;

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
      type: 'SUBMIT'; 
      prompt: string;
      settings: SettingsContext;
      systemPrompts: PromptsContext['systemPrompts'];
      snippets: SnippetsContext['snippets'];
    }
  | { 
      type: 'REGENERATE'; 
      messageIndex: number;
      settings: SettingsContext;
      systemPrompts: PromptsContext['systemPrompts'];
      snippets: SnippetsContext['snippets'];
    }
  | { 
      type: 'EDIT_MESSAGE'; 
      messageIndex: number; 
      newContent: string;
      settings: SettingsContext;
      systemPrompts: PromptsContext['systemPrompts'];
      snippets: SnippetsContext['snippets'];
    }
  | { type: 'CANCEL' }
  | { type: 'SUBMISSION_ERROR'; error: string }
  | { type: 'SAVE_CURRENT_SESSION' }
  | { type: 'DELETE_SESSION'; sessionId: string; navigate: NavigateFunction }
  | { type: 'ADD_MESSAGE'; message: Message; autoScrollEnabled: boolean }
  | { type: 'UPDATE_MESSAGES'; messages: Message[]; autoScrollEnabled: boolean }
  | { type: 'SCROLL_EFFECT_CONSUMED' }
  | { type: 'xstate.done.actor.loadSession'; output: { messages: Message[], sessionId: string, prevId: string | null, nextId: string | null } }
  | { type: 'xstate.error.actor.loadSession', error: unknown };

type LoadSessionInput = { sessionId: string };
type LoadSessionOutput = { messages: Message[], sessionId: string, prevId: string | null, nextId: string | null };
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
    actions: {
        spawnSubmissionActor: assign({
            submissionActor: ({ spawn, context, event, self }) => {
                console.log('[DEBUG] sessionMachine: received event:', JSON.stringify(event));
                if (event.type !== 'SUBMIT' && event.type !== 'REGENERATE' && event.type !== 'EDIT_MESSAGE') {
                    return context.submissionActor;
                }
        
                let messagesToSubmit: Message[];
                let submissionEvent: { type: 'SUBMIT'; prompt: string } | { type: 'REGENERATE' };

                if (event.type === 'SUBMIT') {
                    messagesToSubmit = context.messages;
                    submissionEvent = { type: 'SUBMIT', prompt: event.prompt };
                } else if (event.type === 'REGENERATE') {
                    messagesToSubmit = context.messages.slice(0, event.messageIndex);
                    submissionEvent = { type: 'REGENERATE' };
                } else { // EDIT_MESSAGE
                    messagesToSubmit = context.messages.slice(0, event.messageIndex);
                    submissionEvent = { type: 'SUBMIT', prompt: event.newContent };
                }
        
                const actorInput: ChatSubmissionInput = {
                    messages: messagesToSubmit,
                    // Pass everything from the event
                    systemPrompts: event.systemPrompts,
                    snippets: event.snippets,
                    apiKey: event.settings.apiKey,
                    modelName: event.settings.modelName,
                    autoScrollEnabled: event.settings.autoScrollEnabled,
                    selectedPromptName: event.settings.selectedPromptName,
                    // Callbacks to send events back to self
                    onSuccess: (result) => self.send({ type: 'UPDATE_MESSAGES', ...result }),
                    onError: (error) => self.send({ type: 'SUBMISSION_ERROR', error }),
                };
                console.log('[DEBUG] sessionMachine: Spawning submission actor with input:', JSON.stringify(actorInput, (key, value) => key === 'onSuccess' || key === 'onError' ? 'function' : value, 2));
        
                const actor = spawn(chatSubmissionMachine, { input: actorInput });
                actor.send(submissionEvent);
                return actor;
            }
        }),
    }
}).createMachine({
  id: 'session',
  initial: 'idle',
  context: ({ input }) => ({
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
  }),
  on: {
    SETTINGS_UPDATED: {
        actions: [
            assign({ currentSettings: ({ event }) => event.settings }),
        ],
    },
    '*': {
      actions: () => {}
    }
  },
  states: {
    idle: {
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
            SUBMIT: {
                target: 'processingSubmission',
                actions: [
                    sendTo(({ context }) => context.settingsActor, { type: 'SET_INPUT', text: '' }),
                    'spawnSubmissionActor'
                ],
            },
            REGENERATE: {
                target: 'processingSubmission',
                actions: 'spawnSubmissionActor',
            },
            EDIT_MESSAGE: {
                target: 'processingSubmission',
                actions: 'spawnSubmissionActor',
            },
        }
    },
    processingSubmission: {
        on: {
            CANCEL: {
                actions: ({ context }) => {
                    context.submissionActor?.send({ type: 'CANCEL' });
                }
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
  },
});

export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;
