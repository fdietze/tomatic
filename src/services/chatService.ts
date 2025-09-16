// This service will contain the core logic for processing and submitting chat messages.
// It will be invoked by the chatSubmissionMachine.

import { Message } from '@/types/chat';
import { requestMessageContent } from '@/api/openrouter';
import { resolveSnippets } from '@/utils/snippetUtils';
import { Snippet, SystemPrompt } from '@/types/storage';

export type StreamChatResponseOutput = {
    finalMessages: Message[];
    assistantResponse: string;
};

const getCurrentSystemPrompt = (systemPrompts: SystemPrompt[], name: string | null): SystemPrompt | null => {
    if (!name) return null;
    return systemPrompts.find((p) => p.name === name) || null;
}

// A simplified version of the original submitMessage logic
export const streamChatResponse = async ({
    messages,
    modelName,
    apiKey,
    snippets,
    systemPrompts,
    selectedPromptName,
    prompt,
    isRegeneration,
}: {
    messages: Message[];
    modelName: string;
    apiKey: string;
    snippets: Snippet[];
    systemPrompts: SystemPrompt[];
    selectedPromptName: string | null;
    prompt: string;
    isRegeneration?: boolean;
}): Promise<StreamChatResponseOutput> => {

    const processedContent = resolveSnippets(prompt, snippets);

    let messagesToSubmit = [...messages];

    // Add system prompt if it's the start of a new chat
    const systemPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
    if (messages.length === 0 && systemPrompt) {
        const resolvedContent = resolveSnippets(systemPrompt.prompt, snippets);
        messagesToSubmit.push({
            id: 'system-prompt', // A temporary ID
            role: 'system',
            content: resolvedContent,
            raw_content: systemPrompt.prompt,
            prompt_name: systemPrompt.name,
            model_name: null, cost: null
        });
    }

    let finalMessagesToSubmit: Message[];

    if (isRegeneration) {
        messagesToSubmit = messages.filter(m => m.role !== 'assistant');

        // Re-resolve snippets for system and user messages
        messagesToSubmit = messagesToSubmit.map(message => {
            if ((message.role === 'system' || message.role === 'user') && message.raw_content) {
                const resolvedContent = resolveSnippets(message.raw_content, snippets);
                return {
                    ...message,
                    content: resolvedContent,
                };
            }
            return message;
        });

        if (prompt) { // Only modify if a new prompt is provided (i.e. for editing)
            const lastUserMessageIndex = messagesToSubmit.map(m => m.role).lastIndexOf('user');
            if (lastUserMessageIndex !== -1) {
                const updatedMessages = [...messagesToSubmit];
                const originalMessage = updatedMessages[lastUserMessageIndex];
                updatedMessages[lastUserMessageIndex] = {
                    ...originalMessage,
                    content: processedContent,
                    raw_content: prompt,
                };
                messagesToSubmit = updatedMessages;
            }
        }
        finalMessagesToSubmit = messagesToSubmit;
    } else {
        messagesToSubmit.push({
            id: 'user-message', // A temporary ID
            role: 'user',
            content: processedContent,
            raw_content: prompt,
            prompt_name: null,
            model_name: null,
            cost: null,
        });
        finalMessagesToSubmit = messagesToSubmit;
    }

    const assistantResponse = await requestMessageContent(
        finalMessagesToSubmit,
        modelName,
        apiKey
    );

    return {
        finalMessages: finalMessagesToSubmit,
        assistantResponse,
    };
};
