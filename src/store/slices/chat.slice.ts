import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, ChatSlice } from '@/store/types';
import { Message } from '@/types/chat';
import { requestMessageContent } from '@/api/openrouter';
import { resolveSnippets } from '@/utils/snippetUtils';
import { SystemPrompt } from '@/types/storage';
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
    submitMessage: async ({ promptOverride, navigate, isRegeneration, messagesToRegenerate }) => {
        const { input, apiKey, modelName, selectedPromptName, snippets } = get();
        const rawContent = promptOverride || input;
        if (!rawContent || !apiKey) return;

        let processedContent: string;
        try {
            processedContent = resolveSnippets(rawContent, snippets);
            console.debug(`[STORE|submitMessage] Snippet resolution complete. Original: "${rawContent}", Processed: "${processedContent}"`);
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(error);
            return;
        }

        console.debug(`[STORE|submitMessage] Start. Is regeneration: ${String(isRegeneration)}`);

        let sessionId = get().currentSessionId;
        const isNewSession = !sessionId;
        if (isNewSession) {
            sessionId = uuidv4();
            set({ currentSessionId: sessionId });
        }

        const newMessages: Message[] = [];
        const systemPrompt = getCurrentSystemPrompt(get().systemPrompts, selectedPromptName);
        if (get().messages.length === 0 && systemPrompt) {
            newMessages.push({
                id: uuidv4(),
                role: 'system',
                content: systemPrompt.prompt,
                prompt_name: systemPrompt.name,
                model_name: null, cost: null
            });
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
            console.debug(`[STORE|submitMessage] Adding ${String(newMessages.length)} new message(s) to state.`);
            set((state) => ({ messages: [...state.messages, ...newMessages], input: '' }));
        }
        
        if (isNewSession && navigate && sessionId) {
            console.debug(`[STORE|submitMessage] New session, navigating to /chat/${sessionId}`);
            void navigate(`/chat/${sessionId}`, { replace: true });
        }

        let messagesToSubmit = messagesToRegenerate || get().messages;
        
        // If this is a regeneration, we need to replace the last user message with the newly resolved content
        if (isRegeneration) {
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
        
        console.debug(`[STORE|submitMessage] Submitting ${String(messagesToSubmit.length)} messages to API.`);
        set({ isStreaming: true, error: null });

        try {
            const assistantResponse = await requestMessageContent(
                messagesToSubmit,
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
            
            console.debug('[STORE|submitMessage] Non-streaming response received.');
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
    regenerateMessage: async (index) => {
        console.debug(`[STORE|regenerateMessage] Called for index: ${String(index)}`);
        const { messages, systemPrompts } = get();
        const messagesToRegenerate = [...messages.slice(0, index)];

        const systemMessageIndex = messagesToRegenerate.findIndex(m => m.role === 'system');
        if (systemMessageIndex !== -1) {
            const systemMessage = messagesToRegenerate[systemMessageIndex];
            const latestPrompt = systemPrompts.find(p => p.name === systemMessage.prompt_name);

            if (latestPrompt && latestPrompt.prompt !== systemMessage.content) {
                console.debug(`[STORE|regenerateMessage] Found updated prompt "${latestPrompt.name}". Updating content for regeneration.`);
                messagesToRegenerate[systemMessageIndex] = { ...systemMessage, content: latestPrompt.prompt };
            }
        }
        
        // We need to re-resolve snippets in the user message to get the latest content.
        const lastUserMessageIndex = messagesToRegenerate.map(m => m.role).lastIndexOf('user');
        
        let promptOverride: string | undefined;

        if (lastUserMessageIndex !== -1) {
            const lastUserMessage = messagesToRegenerate[lastUserMessageIndex];
            const rawContent = lastUserMessage.raw_content ?? lastUserMessage.content;
            promptOverride = rawContent;
            console.debug(`[STORE|regenerateMessage] Regenerating with raw content: "${rawContent}"`);
        }
        
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
        console.warn("[STORE|cancelStream] Stream cancellation is not supported in the current non-streaming implementation.");
    },
});