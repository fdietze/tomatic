import { setup, assign, fromPromise, EmittedFrom, sendParent } from 'xstate';
import { streamChatResponse } from '@/services/chatService';
import { Snippet } from '@/types/storage';
import { SettingsContext } from './settingsMachine';
import { PromptsContext } from './promptsMachine';

// --- Machine Types ---

export type SnippetRegenerationContext = {
    name: string;
    error: string | null;
    result: string | null;
    input: SnippetRegenerationInput;
};

export type SnippetRegenerationInput = {
    snippet: Snippet;
    settings: SettingsContext;
    allSnippets: Snippet[];
    allSystemPrompts: PromptsContext['systemPrompts'];
};

export type SnippetRegenerationEmitted = EmittedFrom<typeof snippetRegenerationMachine>;

// --- Machine Definition ---

export const snippetRegenerationMachineSetup = setup({
    types: {
        context: {} as SnippetRegenerationContext,
        input: {} as SnippetRegenerationInput,
        events: {} as 
            | { type: 'xstate.done.actor.regenerate', output: { content: string } }
            | { type: 'xstate.error.actor.regenerate', error: Error },
        emitted: {} as 
            | { type: 'snippet.regeneration.done', name: string; content?: string | null; }
            | { type: 'snippet.regeneration.error', name: string; error?: string | null; }
    },
    actors: {
        regenerateContent: fromPromise<
            { content: string },
            SnippetRegenerationInput
        >(async ({ input }) => {
            const { snippet, allSnippets, settings, allSystemPrompts } = input;
            
            if (!snippet.isGenerated || !snippet.prompt || !snippet.model) {
                throw new Error(`Snippet "${snippet.name}" is not a valid generated snippet and cannot be regenerated.`);
            }

            // If prompt is empty after resolving, no need to call API.
            if (!snippet.prompt.trim()) {
                return { content: '' };
            }

            const { assistantResponse } = await streamChatResponse({
                messages: [],
                prompt: snippet.prompt,
                modelName: snippet.model,
                apiKey: settings.apiKey,
                snippets: allSnippets,
                systemPrompts: allSystemPrompts,
                selectedPromptName: null,
                isRegeneration: false,
            });

            return { content: assistantResponse };
        }),
    },
    actions: {
        sendSuccessToParent: sendParent(({ context }) => ({
            type: 'snippet.regeneration.done',
            name: context.name,
            content: context.result,
        })),
        sendFailureToParent: sendParent(({ context }) => ({
            type: 'snippet.regeneration.error',
            name: context.name,
            error: context.error,
        })),
    },
});

export const snippetRegenerationMachine = snippetRegenerationMachineSetup.createMachine({
  id: 'snippetRegenerator',
  initial: 'regenerating',
  context: ({ input }) => ({
    name: input.snippet.name,
    error: null,
    result: null,
    input,
  }),
  states: {
    regenerating: {
      invoke: {
        id: 'regenerate',
        src: 'regenerateContent',
        input: ({ context }) => context.input,
        onDone: {
          target: 'done',
          actions: assign({
            result: ({ event }) => event.output.content,
          }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => (event.error as Error).message,
          }),
        },
      },
    },
    done: {
        type: 'final',
        entry: 'sendSuccessToParent',
        output: ({ context }) => ({
            name: context.name,
            content: context.result,
        })
    },
    failed: {
      type: 'final',
      entry: 'sendFailureToParent',
      output: ({ context }) => ({
        name: context.name,
        error: context.error,
      })
    },
  },
});
