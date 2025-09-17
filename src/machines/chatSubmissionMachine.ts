import { setup, assign, SnapshotFrom, fromPromise, EmittedFrom, assertEvent } from 'xstate';
import { streamChatResponse, StreamChatResponseOutput, StreamChatResponseInput } from '@/services/chatService';
import { Message } from '@/types/chat';
import { v4 as uuidv4 } from 'uuid';

// The machine's context now only holds state, not config
export interface ChatSubmissionContext {
    error: string | null;
    result?: StreamChatResponseOutput;
    input: ChatSubmissionInput;
}

export type ChatSubmissionEvent =
  | { type: 'SUBMIT'; prompt: string }
  | { type: 'REGENERATE' }
  | { type: 'CANCEL' }
  | { type: 'RETRY' }
  // internal event
  | { type: 'xstate.done.actor.streamResponse', output: StreamChatResponseOutput }
  | { type: 'xstate.error.actor.streamResponse', error: unknown };

// The input to the machine now contains all the necessary data
export interface ChatSubmissionInput extends Omit<StreamChatResponseInput, 'prompt' | 'isRegeneration'> {
    autoScrollEnabled: boolean;
    onSuccess: (result: { messages: Message[], autoScrollEnabled: boolean }) => void;
    onError: (error: string) => void;
}

type StreamResponseInput = {
    event: { type: 'SUBMIT'; prompt: string } | { type: 'REGENERATE' };
    input: ChatSubmissionInput; // Pass the machine's input
    context: ChatSubmissionContext; // The current context
};

export const chatSubmissionMachine = setup({
    types: {
        context: {} as ChatSubmissionContext,
        events: {} as ChatSubmissionEvent,
        input: {} as ChatSubmissionInput,
    },
    actors: {
        streamResponse: fromPromise<StreamChatResponseOutput, StreamResponseInput>(
            async ({ input }) => {
                const { event, input: machineInput } = input;
                const isRegeneration = event.type === 'REGENERATE';
                const prompt = event.type === 'SUBMIT' ? event.prompt : '';
                
                const serviceInput: StreamChatResponseInput = {
                    ...machineInput,
                    prompt,
                    isRegeneration,
                };

                return await streamChatResponse(serviceInput);
            }
        ),
    },
    actions: {
        sendSuccess: assign({
            result: ({ event, context }) => {
                assertEvent(event, 'xstate.done.actor.streamResponse');
                const { finalMessages, assistantResponse } = event.output;
                const { modelName, autoScrollEnabled, selectedPromptName, onSuccess } = context.input;
                
                const assistantMessage: Message = {
                    id: uuidv4(),
                    role: 'assistant',
                    content: assistantResponse,
                    model_name: modelName,
                    cost: null,
                    prompt_name: selectedPromptName,
                };
    
                onSuccess({
                    messages: [...finalMessages, assistantMessage],
                    autoScrollEnabled,
                });
                return context.result;
            }
        }),
        sendError: ({ event, context }) => {
            assertEvent(event, 'xstate.error.actor.streamResponse');
            const error = event.error;
            const errorMessage = error instanceof Error ? error.message : String(error);
            context.input.onError(errorMessage);
        }
    }
}).createMachine({
  id: 'chatSubmission',
  initial: 'idle',
  context: ({ input }) => ({
    error: null,
    result: undefined,
    input,
  }),
  states: {
    idle: {
      on: {
        SUBMIT: 'streaming',
        REGENERATE: 'streaming',
      },
    },
    streaming: {
      invoke: {
        id: 'streamResponse',
        src: 'streamResponse',
        input: ({ context, event }) => { 
            assertEvent(event, ['SUBMIT', 'REGENERATE']);
            return {
                context,
                input: context.input,
                event
            };
        },
        onDone: {
          target: 'finalizing',
          actions: 'sendSuccess',
        },
        onError: {
          target: 'failure',
          actions: [
            assign({
              error: ({ event }) => {
                assertEvent(event, 'xstate.error.actor.streamResponse');
                const error = event.error;
                return error instanceof Error ? error.message : String(error);
              }
            }),
            'sendError'
          ],
        },
      }
    },
    finalizing: {
        always: 'idle'
    },
    failure: {
      on: {
        RETRY: 'streaming',
        SUBMIT: 'streaming',
      },
    },
  },
});

export type ChatSubmissionActor = EmittedFrom<typeof chatSubmissionMachine>;
export type ChatSubmissionSnapshot = SnapshotFrom<typeof chatSubmissionMachine>;
