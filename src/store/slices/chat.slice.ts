import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, ChatSlice } from '@/store/types';
import { Message } from '@/types/chat';
import { requestMessageContent } from '@/api/openrouter';
import { resolveSnippets } from '@/utils/snippetUtils';
import { Snippet, SystemPrompt } from '@/types/storage';
import {findNeighbourSessionIds, loadSession} from "@/services/db";


const getCurrentSystemPrompt = (systemPrompts: SystemPrompt[], name: string | null): SystemPrompt | null => {
    if (!name) return null;
    return systemPrompts.find((p) => p.name === name) || null;
}

export const createChatSlice: StateCreator<
    AppState,
    [],
    [],
    ChatSlice
> = (set, get) => ({
    isStreaming: false,
    streamController: null,
    submitMessage: async ({ promptOverride, navigate, isRegeneration, messagesToRegenerate, snippetsOverride }: { promptOverride?: string; navigate?: (path: string, options?: { replace?: boolean }) => void; isRegeneration?: boolean; messagesToRegenerate?: Message[]; snippetsOverride?: Snippet[] }) => {
        console.debug('[DEBUG] submitMessage: State at START', {
            systemPrompts: get().systemPrompts.map(p => p.prompt),
            snippets: get().snippets.map(s => ({ name: s.name, content: s.content })),
        });
        const { input, apiKey, modelName, selectedPromptName } = get();
        const rawContent = promptOverride || input;
        if (!rawContent || !apiKey) return;

        try {
            // Comprehensive dependency check: include snippets from the user prompt AND the system prompt.
            const systemPrompt = getCurrentSystemPrompt(get().systemPrompts, selectedPromptName);
            const systemPromptContent = (get().messages.length === 0 && systemPrompt) ? systemPrompt.prompt : '';
            const combinedContent = `${rawContent} ${systemPromptContent}`;
            await get().waitForDependentSnippets(combinedContent);
        } catch {
            return; // Error is already set in the utility slice, so we just stop.
        }

        const snippets = snippetsOverride || get().snippets; // Use in-memory state
        console.debug('[DEBUG] submitMessage: Using snippets for resolution:', JSON.stringify(snippets.map(s => ({ name: s.name, content: s.content }))));
        
        let processedContent: string;
        try {
            processedContent = resolveSnippets(rawContent, snippets);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(error);
            return;
        }

        let sessionId = get().currentSessionId;
        const isNewSession = !sessionId;
        if (isNewSession) {
            sessionId = uuidv4();
            set({ currentSessionId: sessionId });
        }

        const newMessages: Message[] = [];
        const systemPrompt = getCurrentSystemPrompt(get().systemPrompts, selectedPromptName);
        if (get().messages.length === 0 && systemPrompt) {
            try {
                const resolvedContent = resolveSnippets(systemPrompt.prompt, snippets);
                const systemMessage: Message = {
                    id: uuidv4(),
                    role: 'system',
                    content: resolvedContent,
                    raw_content: systemPrompt.prompt,
                    prompt_name: systemPrompt.name,
                    model_name: null, cost: null
                };
                newMessages.push(systemMessage);
            } catch (e) {
                const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                get().setError(error);
                return;
            }
        }

        if (!isRegeneration) {
            const userMessage: Message = {
                id: uuidv4(),
                role: 'user',
                content: processedContent,
                prompt_name: null,
                model_name: null,
                cost: null,
            };
            if (rawContent !== processedContent) {
                userMessage.raw_content = rawContent;
            }
            newMessages.push(userMessage);
        }

        if (newMessages.length > 0) {
            set((state) => ({ messages: [...state.messages, ...newMessages], input: '' }));
        }

        if (isNewSession && navigate && sessionId) {
            navigate(`/chat/${sessionId}`, { replace: true });
        }

        let messagesToSubmit;
        if (messagesToRegenerate) {
            messagesToSubmit = messagesToRegenerate;
        } else {
            messagesToSubmit = get().messages;
        }

        // If this is a regeneration, we need to replace the last user message with the newly resolved content
        if (isRegeneration) {
            // This is a critical fix. When regenerating, we must ensure we are not including any old assistant messages.
            messagesToSubmit = messagesToSubmit.filter(m => m.role !== 'assistant');
            const lastUserMessageIndex = messagesToSubmit.map(m => m.role).lastIndexOf('user');
            if (lastUserMessageIndex !== -1) {
                const updatedMessages = [...messagesToSubmit];
                const originalMessage = updatedMessages[lastUserMessageIndex];
                updatedMessages[lastUserMessageIndex] = {
                    ...originalMessage,
                    content: processedContent,
                    raw_content: rawContent,
                };
                messagesToSubmit = updatedMessages;
            }
        }

        set({ isStreaming: true, error: null });

        try {
            const finalMessagesToSubmit = messagesToSubmit.map(m => {
                if (m.role === 'system') {
                    const resolvedContent = resolveSnippets(m.raw_content || m.content, snippets);
                    console.debug(`[DEBUG] submitMessage: Final resolved system prompt for API call: "${resolvedContent}"`);
                    return { ...m, content: resolvedContent };
                }
                return m;
            });

            const assistantResponse = await requestMessageContent(
                finalMessagesToSubmit,
                modelName,
                apiKey
            );

            const assistantMessage: Message = {
                id: uuidv4(),
                role: 'assistant',
                content: assistantResponse,
                model_name: modelName,
                cost: null, // Cost calculation would need to be re-implemented if usage data is not available from the non-streaming endpoint
                prompt_name: null,
            };

            if (isRegeneration) {
                set({ messages: [...messagesToSubmit, assistantMessage] });
            } else {
                set(state => ({ messages: [...state.messages, assistantMessage] }));
            }

            set({ isStreaming: false });
            await get().saveCurrentSession();
            const sessionId = get().currentSessionId;
            if (sessionId) {
                const currentSession = await loadSession(sessionId);
                if (currentSession) {
                    const { prevId, nextId } = await findNeighbourSessionIds(currentSession);
                    set({ prevSessionId: prevId, nextSessionId: nextId });
                }
            }

        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(error);
            set(state => ({ messages: state.messages.filter(m => m.role !== 'assistant' || m.content !== '') }));
            set({ isStreaming: false });
        }
    },
    regenerateMessage: async (index: number) => {
        // Explicitly reload prompts to prevent race conditions where a prompt is edited on
        // the settings page and then immediately used for regeneration.
        console.debug('[DEBUG] regenerateMessage: State BEFORE loadSystemPrompts', {
            systemPrompts: get().systemPrompts.map(p => p.prompt),
            snippets: get().snippets.map(s => ({ name: s.name, content: s.content })),
        });
        await get().loadSystemPrompts();
        console.debug('[DEBUG] regenerateMessage: State AFTER loadSystemPrompts', {
            systemPrompts: get().systemPrompts.map(p => p.prompt),
            snippets: get().snippets.map(s => ({ name: s.name, content: s.content })),
        });
        const { messages } = get();
        console.debug(`[DEBUG] regenerateMessage: Snippets in store state at start:`, JSON.stringify(get().snippets.map(s => ({ name: s.name, content: s.content }))));
        
        const messagesToRegenerate = messages.slice(0, index);

        // We need to re-resolve snippets in the user message to get the latest content.
        const lastUserMessageIndex = messagesToRegenerate.map(m => m.role).lastIndexOf('user');

        let promptOverride: string | undefined;

        if (lastUserMessageIndex !== -1) {
            const lastUserMessage = messagesToRegenerate[lastUserMessageIndex];
            const rawContent = lastUserMessage.raw_content ?? lastUserMessage.content;
            promptOverride = rawContent;
        }

        // This is a critical fix. When regenerating, we must ensure we are not including any old assistant messages.
        await get().submitMessage({ isRegeneration: true, messagesToRegenerate, promptOverride });
    },
    editAndResubmitMessage: async (index, newContent) => {
        const { messages } = get();
        const messagesToRegenerate = [...messages.slice(0, index + 1)];

        // Pass the new raw content directly to submitMessage for resolution.
        await get().submitMessage({ promptOverride: newContent, isRegeneration: true, messagesToRegenerate });
    },
    cancelStream: () => {
        // Since we're no longer streaming, this could be a no-op,
        // but we'll leave it in case we re-introduce cancellable requests.
    },
});