import { setup, assign, SnapshotFrom, fromPromise } from 'xstate';
import { streamChatResponse, StreamChatResponseOutput } from '@/services/chatService';
import { Message } from '@/types/chat';
import { Snippet, SystemPrompt } from '@/types/storage';
import { v4 as uuidv4 } from 'uuid';

// Define the machine's context, events, and input
export interface ChatSubmissionContext {
    error: string | null;
    finalResponseData?: StreamChatResponseOutput;
    config: ChatSubmissionInput & {
        onSuccess: (result: { messages: Message[], autoScrollEnabled: boolean }) => void;
        onError: (error: string) => void;
    };
}

export type ChatSubmissionEvent =
  | { type: 'SUBMIT'; prompt: string }
  | { type: 'REGENERATE' }
  | { type: 'CANCEL' }
  | { type: 'xstate.done.actor.fetchAndProcess', output: StreamChatResponseOutput };

export interface ChatSubmissionInput {
    messages: Message[];
    modelName: string;
    apiKey: string;
    snippets: Snippet[];
    systemPrompts: SystemPrompt[];
    selectedPromptName: string | null;
    autoScrollEnabled: boolean;
    onSuccess: (result: { messages: Message[], autoScrollEnabled: boolean }) => void;
    onError: (error: string) => void;
}

export const chatSubmissionMachine = setup({
    types: {
        context: {} as ChatSubmissionContext,
        events: {} as ChatSubmissionEvent,
        input: {} as ChatSubmissionInput,
    },
    actions: {
        sendSuccess: ({ context }: { context: ChatSubmissionContext }) => {
            if (!context.finalResponseData) return;
            const { finalMessages, assistantResponse } = context.finalResponseData;
            const { modelName, autoScrollEnabled } = context.config;
            const finalMessagesWithIds = finalMessages.map(m => ({ ...m, id: uuidv4() }));
            const assistantMessage: Message = {
                id: uuidv4(),
                role: 'assistant',
                content: assistantResponse,
                model_name: modelName,
                cost: null, // Cost is not available in this context
                prompt_name: context.config.selectedPromptName,
            };
            context.config.onSuccess({
                messages: [...finalMessagesWithIds, assistantMessage],
                autoScrollEnabled,
            });
        },
        sendError: ({ context }: { context: ChatSubmissionContext }) => {
            if (!context.error) return;
            context.config.onError(context.error);
        }
    }
}).createMachine({
  id: 'chatSubmission',
  initial: 'idle',
  context: ({ input }) => ({
    error: null,
    finalResponseData: undefined,
    config: input,
  }),
  states: {
    idle: {
      entry: (): void => { console.log('[DEBUG] chatSubmissionMachine: entering idle') },
      on: {
        SUBMIT: 'composingMessage',
        REGENERATE: 'composingMessage',
      },
    },
    composingMessage: {
      invoke: {
        id: 'fetchAndProcess',
        src: fromPromise(async ({ input }) => {
            const { context, event } = input as { context: ChatSubmissionContext, event: { type: 'SUBMIT', prompt: string } | { type: 'REGENERATE' } };
            const isRegeneration = event.type === 'REGENERATE';
            const prompt = event.type === 'SUBMIT' ? event.prompt : '';
            return await streamChatResponse({ ...context.config, prompt, isRegeneration });
        }),
        input: ({ context, event }: { context: ChatSubmissionContext, event: ChatSubmissionEvent }) => ({ context, event }),
        onDone: {
          target: 'finalizing',
          actions: assign({
            finalResponseData: ({ event }: { event: { output: StreamChatResponseOutput }}) => event.output,
          }),
        },
        onError: {
          target: 'failure',
          actions: [
            assign({
                error: ({ event }) => (event.error as Error).message,
            }),
            'sendError'
          ],
        },
      }
    },
    streamingResponse: {
      on: {
        CANCEL: 'idle',
      },
    },
    finalizing: {
        entry: [
            (): void => { console.log('[DEBUG] chatSubmissionMachine: entering finalizing') },
            'sendSuccess'
        ],
        always: 'idle'
    },
    failure: {
      entry: (): void => { console.log('[DEBUG] chatSubmissionMachine: entering failure') },
      on: {
        RETRY: 'composingMessage',
        SUBMIT: 'composingMessage',
      },
    },
  },
});

export type ChatSubmissionSnapshot = SnapshotFrom<typeof chatSubmissionMachine>;
