import { setup, assign, fromPromise, assertEvent } from 'xstate';
import { streamChatResponse, StreamChatResponseOutput, StreamChatResponseInput } from '@/services/chatService';
import { Snippet, SystemPrompt } from '@/types/storage';
import { SettingsContext } from './settingsMachine';

// --- Context ---
export interface SnippetRegenerationContext {
    name: string;
    error?: string;
    result?: string;
    // Include necessary config for the API call
    apiKey: string;
    modelName: string;
    snippets: Snippet[];
    systemPrompts: SystemPrompt[];
    onDone: (output: { name: string, content?: string }) => void;
    onError: (name: string) => void;
}

// --- Events ---
export type SnippetRegenerationEvent =
  | { type: 'xstate.done.actor.regenerate', output: StreamChatResponseOutput }
  | { type: 'xstate.error.actor.regenerate', error: Error };

// --- Input ---
export type SnippetRegenerationInput = {
    snippet: Snippet;
    settings: SettingsContext;
    allSnippets: Snippet[];
    allSystemPrompts: SystemPrompt[];
    onDone: (output: { name: string, content?: string }) => void;
    onError: (name: string) => void;
};


export const snippetRegenerationMachine = setup({
    types: {} as {
        context: SnippetRegenerationContext,
        events: SnippetRegenerationEvent,
        input: SnippetRegenerationInput,
    },
    actors: {
        regenerate: fromPromise<StreamChatResponseOutput, SnippetRegenerationContext>(
            async ({ input }) => {
                const serviceInput: StreamChatResponseInput = {
                    messages: [], // Regeneration starts with no message history
                    apiKey: input.apiKey,
                    modelName: input.modelName,
                    snippets: input.snippets,
                    systemPrompts: input.systemPrompts,
                    selectedPromptName: null, // Regeneration doesn't use a selected prompt
                    prompt: input.name, // The "prompt" is the snippet's own prompt
                    isRegeneration: false, // Treat as a new generation
                };
                return await streamChatResponse(serviceInput);
            }
        ),
    }
}).createMachine({
    id: 'snippetRegenerator',
    initial: 'regenerating',
    context: ({ input }) => ({
        name: input.snippet.name,
        apiKey: input.settings.apiKey,
        modelName: input.snippet.model ?? input.settings.modelName,
        snippets: input.allSnippets,
        systemPrompts: input.allSystemPrompts,
        onDone: input.onDone,
        onError: input.onError,
    }),
    states: {
        regenerating: {
            invoke: {
                src: 'regenerate',
                input: ({ context }) => context,
                onDone: {
                    target: 'success',
                    actions: assign({ 
                        result: ({ event }) => {
                            assertEvent(event, 'xstate.done.actor.regenerate');
                            return event.output.assistantResponse;
                        }
                    }),
                },
                onError: {
                    target: 'failure',
                    actions: assign({ 
                        error: ({ event }) => {
                            assertEvent(event, 'xstate.error.actor.regenerate');
                            return (event.error as Error).message;
                        }
                    }),
                },
            },
        },
        success: {
            type: 'final',
            entry: ({ context }) => {
                context.onDone({
                    name: context.name,
                    content: context.result,
                });
            },
            output: ({ context }) => ({
                name: context.name,
                content: context.result,
            }),
        },
        failure: {
            type: 'final',
            entry: ({ context }) => {
                context.onError(context.name);
            },
        },
    },
});
