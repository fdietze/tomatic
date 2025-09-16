import { setup, assign, SnapshotFrom, ActorRefFrom, stop, Spawner, AnyActorLogic, sendTo, fromPromise } from 'xstate';
import { Message } from '@/types/chat';
import * as db from '@/services/db';
import { NavigateFunction } from 'react-router-dom';
import { chatSubmissionMachine } from '@/machines/chatSubmissionMachine';
import { settingsMachine } from './settingsMachine';
import { promptsMachine } from './promptsMachine';
import { snippetsMachine } from './snippetsMachine';
// DO NOT re-add resolveSnippets import, it's the source of the bug
// import { resolveSnippets } from '@/utils/snippetUtils';

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

export type SessionEvent =
  | { type: 'LOAD_SESSION'; sessionId: string }
  | { type: 'START_NEW_SESSION'; systemPrompt?: { name: string; prompt: string } }
  | { type: 'SUBMIT'; prompt: string }
  | { type: 'REGENERATE'; messageIndex: number }
  | { type: 'EDIT_MESSAGE'; messageIndex: number; newContent: string }
  | { type: 'CANCEL' }
  | { type: 'SUBMISSION_ERROR'; error: string }
  | { type: 'SAVE_CURRENT_SESSION' }
  | { type: 'DELETE_SESSION'; sessionId: string; navigate: NavigateFunction }
  | { type: 'ADD_MESSAGE'; message: Message; autoScrollEnabled: boolean }
  | { type: 'UPDATE_MESSAGES'; messages: Message[]; autoScrollEnabled: boolean }
  | { type: 'SCROLL_EFFECT_CONSUMED' }
  | { type: 'xstate.done.actor.loadSession'; output: { messages: Message[], sessionId: string, prevId: string | null, nextId: string | null } };

type LoadSessionDoneEvent = Extract<SessionEvent, { type: 'xstate.done.actor.loadSession' }>;

const spawnAndInitializeSubmissionActor = assign({
    submissionActor: ({ spawn, event, self, context }: {
        spawn: Spawner<AnyActorLogic>;
        event: SessionEvent;
        self: ActorRefFrom<typeof sessionMachine>;
        context: SessionContext;
    }) => {
        const submitEvent = event as Extract<SessionEvent, { type: 'SUBMIT' }>;
        const { settingsActor, promptsActor, snippetsActor } = context;
        const { apiKey, modelName, selectedPromptName, autoScrollEnabled } = settingsActor.getSnapshot().context;
        const systemPrompts = promptsActor.getSnapshot().context.systemPrompts;
        const snippets = snippetsActor.getSnapshot().context.snippets;
        

        const actor = spawn(chatSubmissionMachine, {
            systemId: 'chatSubmissionActor',
            input: {
                messages: context.messages,
                apiKey,
                modelName,
                systemPrompts,
                snippets,
                selectedPromptName,
                onSuccess: (result) => {
                    self.send({ type: 'UPDATE_MESSAGES', messages: result.messages, autoScrollEnabled });
                },
                onError: (error) => {
                    self.send({ type: 'SUBMISSION_ERROR', error });
                }
            }
        });
        
        actor.send({ type: 'SUBMIT', prompt: submitEvent.prompt });

        return actor;
    }
});

const spawnAndInitializeSubmissionActorForRegenerate = assign({
    submissionActor: ({ spawn, event, self, context }: {
        spawn: Spawner<AnyActorLogic>;
        event: SessionEvent;
        self: ActorRefFrom<typeof sessionMachine>;
        context: SessionContext;
    }) => {
        const regenerateEvent = event as Extract<SessionEvent, { type: 'REGENERATE' }>;
        const { settingsActor, promptsActor, snippetsActor } = context;
        const { apiKey, modelName, selectedPromptName, autoScrollEnabled } = settingsActor.getSnapshot().context;
        const systemPrompts = promptsActor.getSnapshot().context.systemPrompts;
        const snippets = snippetsActor.getSnapshot().context.snippets;

        const messagesToSubmit = context.messages.slice(0, regenerateEvent.messageIndex);
        const lastUserMessage = messagesToSubmit.filter(m => m.role === 'user').pop();
        if (!lastUserMessage) return context.submissionActor;

        const actor = spawn(chatSubmissionMachine, {
            systemId: 'chatSubmissionActor',
            input: {
                messages: messagesToSubmit,
                apiKey,
                modelName,
                systemPrompts,
                snippets,
                selectedPromptName,
                onSuccess: (result) => {
                    self.send({ type: 'UPDATE_MESSAGES', messages: result.messages, autoScrollEnabled });
                },
                onError: (error) => {
                    self.send({ type: 'SUBMISSION_ERROR', error });
                }
            }
        });
        
        actor.send({ type: 'REGENERATE' });

        return actor;
    }
});

const spawnAndInitializeSubmissionActorForEdit = assign({
    submissionActor: ({ spawn, event, self, context }: {
        spawn: Spawner<AnyActorLogic>;
        event: SessionEvent;
        self: ActorRefFrom<typeof sessionMachine>;
        context: SessionContext;
    }) => {
        const editEvent = event as Extract<SessionEvent, { type: 'EDIT_MESSAGE' }>;
        const { settingsActor, promptsActor, snippetsActor } = context;
        const { apiKey, modelName, selectedPromptName, autoScrollEnabled } = settingsActor.getSnapshot().context;
        const systemPrompts = promptsActor.getSnapshot().context.systemPrompts;
        const snippets = snippetsActor.getSnapshot().context.snippets;

        const messagesToSubmit = context.messages.slice(0, editEvent.messageIndex);
        

        const actor = spawn(chatSubmissionMachine, {
            systemId: 'chatSubmissionActor',
            input: {
                messages: messagesToSubmit,
                apiKey,
                modelName,
                systemPrompts,
                snippets,
                selectedPromptName,
                onSuccess: (result) => {
                    self.send({ type: 'UPDATE_MESSAGES', messages: result.messages, autoScrollEnabled });
                },
                onError: (error) => {
                    self.send({ type: 'SUBMISSION_ERROR', error });
                }
            }
        });
        
        actor.send({ type: 'SUBMIT', prompt: editEvent.newContent });

        return actor;
    }
});

export const sessionMachine = setup({
    types: {
        context: {} as SessionContext,
        events: {} as SessionEvent,
        input: {} as SessionMachineInput,
    },
    actors: {
        loadSession: fromPromise(async ({ input }: { input: { sessionId: string } }) => {
            const session = await db.loadSession(input.sessionId);
            if (!session) throw new Error("Session not found");
            const { prevId, nextId } = await db.findNeighbourSessionIds(session);
            return { ...session, prevId, nextId, sessionId: input.sessionId };
        }),
        saveSession: fromPromise(async ({ context }: { context: SessionContext }) => {
            if (context.currentSessionId) {
                await db.saveSession({ id: context.currentSessionId, messages: context.messages });
            }
        }),
    },
    actions: {
        assignLoadedSession: assign({
            messages: ({ event }: { event: LoadSessionDoneEvent }) => event.output.messages,
            currentSessionId: ({ event }: { event: LoadSessionDoneEvent }) => event.output.sessionId,
            prevSessionId: ({ event }: { event: LoadSessionDoneEvent }) => event.output.prevId,
            nextSessionId: ({ event }: { event: LoadSessionDoneEvent }) => event.output.nextId,
            scrollEffect: { type: 'scrollToBottom' },
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
    ...input
  }),
  on: {
    '*': {
      actions: () => {
      }
    }
  },
  states: {
    idle: {
        on: {
            LOAD_SESSION: {
                target: 'loading',
            },
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
                    sendTo(
                        ({ context }) => context.settingsActor,
                        { type: 'SET_INPUT', text: '' }
                    ),
                    spawnAndInitializeSubmissionActor
                ],
            },
            REGENERATE: {
                target: 'processingSubmission',
                actions: spawnAndInitializeSubmissionActorForRegenerate
            },
            EDIT_MESSAGE: {
                target: 'processingSubmission',
                actions: spawnAndInitializeSubmissionActorForEdit
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
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            stop<SessionContext>(({ context }) => context.submissionActor),
            assign({
            messages: ({ event }) => event.messages,
            scrollEffect: ({ event }) => {
                const { autoScrollEnabled, messages } = event as { autoScrollEnabled: boolean, messages: Message[] };
                if (autoScrollEnabled) {
                    return { type: 'scrollToBottom' };
                }
                if (messages.length > 0) {
                    const lastMessage = messages[messages.length - 1];
                    if (lastMessage && lastMessage.role === 'user') {
                        return { type: 'scrollToLastUserMessage' };
                    }
                }
                return null;
            },
            submissionActor: null
        }),
        ],
        },
        SUBMISSION_ERROR: {
            target: 'idle',
            actions: [
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                stop<SessionContext>(({ context }) => context.submissionActor),
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
        input: ({ event }) => ({ sessionId: (event as { type: 'LOAD_SESSION', sessionId: string }).sessionId }),
        onDone: {
          target: 'idle',
          actions: [
            'assignLoadedSession',
        ],
        },
        onError: {
          target: 'idle',
          actions: [
              assign({ error: 'Failed to load session' }),
              ({ event }): void => { console.error('[DEBUG] sessionMachine: loadSession invocation failed (onError).', event.error); }
          ],
        },
      },
    },
    saving: {
        invoke: {
            id: 'saveSession',
            src: 'saveSession',
            onDone: 'idle',
            onError: {
                target: 'idle',
                actions: assign({ error: 'Failed to save session' }),
            }
        }
    }
  },
});

export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;
