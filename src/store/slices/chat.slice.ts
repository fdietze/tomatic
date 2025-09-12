import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, ChatSlice } from '@/store/types';
import { Message } from '@/types/chat';
import { requestMessageContentStreamed } from '@/api/openrouter';
import { resolveSnippets } from '@/utils/snippetUtils';
import { ChatCompletionChunk } from 'openai/resources/chat';
import {findNeighbourSessionIds, loadSession} from "@/services/persistence";

import { SystemPrompt } from '@/types/storage';

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

        const messagesToSubmit = messagesToRegenerate || get().messages;
        console.debug(`[STORE|submitMessage] Submitting ${String(messagesToSubmit.length)} messages to API.`);
        set({ isStreaming: true, error: null });

        const controller = new AbortController();
        set({ streamController: controller });

        try {
            const stream = await requestMessageContentStreamed(
                messagesToSubmit,
                modelName,
                apiKey
            );

            if (isRegeneration) {
                set({ 
                    messages: [...messagesToSubmit, { id: uuidv4(), role: 'assistant', content: '', model_name: modelName, cost: null, prompt_name: null }] 
                });
            } else {
                set((state) => ({ 
                    messages: [...state.messages, { id: uuidv4(), role: 'assistant', content: '', model_name: modelName, cost: null, prompt_name: null }] 
                }));
            }
            console.debug('[STORE|submitMessage] Entering stream processing loop...');
            let finalChunk: ChatCompletionChunk | undefined;
            for await (const chunk of stream) {
                finalChunk = chunk;
                if (controller.signal.aborted) {
                    stream.controller.abort();
                    break;
                }
                const contentChunk = chunk.choices[0]?.delta?.content || '';
                set((state) => {
                    if (state.messages.length === 0 || state.messages[state.messages.length - 1].role !== 'assistant') {
                        console.warn('[STORE|submitMessage] Stream update skipped: no assistant message found at the end of the message array.');
                        return state;
                    }
                    const lastMessage = state.messages[state.messages.length - 1];
                    const updatedMessage = { ...lastMessage, content: lastMessage.content + contentChunk };
                    return { messages: [...state.messages.slice(0, -1), updatedMessage] };
                });
            }
            
            if (finalChunk?.usage) {
                console.debug('[STORE|submitMessage] Usage data received:', finalChunk.usage);
                const { prompt_tokens, completion_tokens } = finalChunk.usage;
                const { cachedModels, modelName } = get();
                const modelInfo = cachedModels.find(m => m.id === modelName);

                if (modelInfo && prompt_tokens && completion_tokens) {
                    const promptCost = (prompt_tokens / 1_000_000) * (modelInfo.prompt_cost_usd_pm || 0);
                    const completionCost = (completion_tokens / 1_000_000) * (modelInfo.completion_cost_usd_pm || 0);

                    set(state => {
                        const lastMessage = state.messages[state.messages.length - 1];
                        if (lastMessage.role === 'assistant') {
                            const updatedMessage = {
                                ...lastMessage,
                                cost: {
                                    prompt: promptCost,
                                    completion: completionCost,
                                    prompt_tokens: prompt_tokens,
                                    completion_tokens: completion_tokens,
                                }
                            };
                            return { messages: [...state.messages.slice(0, -1), updatedMessage] };
                        }
                        return state;
                    });
                }
            }

            console.debug('[STORE|submitMessage] Stream finished.');
            set({ isStreaming: false, streamController: null });
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
            set({ isStreaming: false, streamController: null });
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
        
        const lastUserMessageIndex = messagesToRegenerate.map(m => m.role).lastIndexOf('user');
        
        if (lastUserMessageIndex !== -1) {
            const lastUserMessage = messagesToRegenerate[lastUserMessageIndex];
            const contentForRegeneration = lastUserMessage.raw_content || lastUserMessage.content;
            
            console.debug(`[STORE|regenerateMessage] Regenerating with raw content: "${contentForRegeneration}"`);
            
            // Re-resolve snippets before submitting
            const { snippets } = get();
            try {
                // We resolve the snippets here just to update the `content` field of the last user message.
                const resolvedContent = resolveSnippets(contentForRegeneration, snippets);
                messagesToRegenerate[lastUserMessageIndex] = { ...lastUserMessage, content: resolvedContent };
                console.debug(`[STORE|regenerateMessage] Snippets re-resolved. New content: "${resolvedContent}"`);
            } catch (e) {
                const error = e instanceof Error ? e.message : 'An unknown error occurred.';
                get().setError(error);
                return;
            }

            await get().submitMessage({ 
                promptOverride: contentForRegeneration, // This is still needed to trigger resolution in submitMessage
                isRegeneration: true, 
                messagesToRegenerate 
            });
        }
    },
    editAndResubmitMessage: async (index, newContent) => {
        const newMessages = [...get().messages];
        newMessages[index] = { ...newMessages[index], content: newContent, raw_content: newContent };
        
        set({ messages: newMessages.slice(0, index + 1) });
        
        await get().submitMessage({ 
            promptOverride: newContent, 
            isRegeneration: true,
            // Pass the *updated* message history to submitMessage
            messagesToRegenerate: newMessages.slice(0, index + 1) 
        });
    },
    cancelStream: () => {
        get().streamController?.abort();
    },
});