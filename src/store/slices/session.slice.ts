import { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { AppState, SessionSlice } from '@/store/types';
import { ChatSession, Message } from '@/types/chat';
import {
    deleteSession as dbDeleteSession,
    findNeighbourSessionIds,
    getMostRecentSessionId,
    loadSession,
    saveSession,
} from '@/services/db';

import { SystemPrompt } from '@/types/storage';

const getCurrentSystemPrompt = (systemPrompts: SystemPrompt[], name: string | null): SystemPrompt | null => {
    if (!name) return null;
    return systemPrompts.find((p) => p.name === name) || null;
}

export const createSessionSlice: StateCreator<
    AppState,
    [],
    [],
    SessionSlice
> = (set, get) => ({
    messages: [],
    currentSessionId: null,
    prevSessionId: null,
    nextSessionId: null,
    loadSession: async (sessionId) => {
        if (get().currentSessionId === sessionId && sessionId !== 'new') {
            return;
        }
        console.debug(`[STORE|loadSession] Loading session: ${sessionId}`);
        if (get().isStreaming) {
            get().cancelStream();
        }

        set({ error: null, messages: [], currentSessionId: sessionId });

        if (sessionId === 'new') {
            await get().startNewSession();
            return;
        }

        try {
            const session = await loadSession(sessionId);
            if (session) {
                const systemMessage = session.messages.find(m => m.role === 'system');
                const lastAssistantMessage = [...session.messages].reverse().find(m => m.role === 'assistant');
                const { prevId, nextId } = await findNeighbourSessionIds(session);

                const newState: Partial<AppState> = {
                    messages: session.messages,
                    currentSessionId: session.session_id,
                    selectedPromptName: systemMessage?.prompt_name || null,
                    prevSessionId: prevId,
                    nextSessionId: nextId,
                };

                if (lastAssistantMessage?.model_name) {
                    newState.modelName = lastAssistantMessage.model_name;
                }

                set(newState);
            } else {
                get().setError(`Session ${sessionId} not found.`);
                await get().startNewSession();
            }
        } catch (e) {
            console.error(e);
            get().setError('Failed to load session.');
        }
    },
    startNewSession: async () => {
        const mostRecentId = await getMostRecentSessionId();
        const { systemPrompts, selectedPromptName } = get();
        const systemPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
        console.debug(`[STORE|startNewSession] Starting new session. Most recent was: ${String(mostRecentId)}`);

        const initialMessages: Message[] = [];
        if (systemPrompt) {
            initialMessages.push({
                id: uuidv4(),
                role: 'system',
                content: systemPrompt.prompt,
                prompt_name: systemPrompt.name,
                model_name: null,
                cost: null,
            });
        }

        set({
            messages: initialMessages,
            currentSessionId: null,
            prevSessionId: mostRecentId, // The "previous" session from "new" is the most recent one
            nextSessionId: null,
        });
    },
    saveCurrentSession: async () => {
        const { currentSessionId, messages } = get();
        if (messages.length === 0 || !currentSessionId) return;

        const existingSession = await loadSession(currentSessionId);

        const session: ChatSession = {
            session_id: currentSessionId,
            messages,
            created_at_ms: existingSession?.created_at_ms || Date.now(),
            updated_at_ms: Date.now(),
            name: existingSession?.name || null,
        };
        await saveSession(session);
    },
    deleteSession: async (sessionId, navigate) => {
        const sessionToDelete = await loadSession(sessionId);
        if (!sessionToDelete) return;

        const { prevId } = await findNeighbourSessionIds(sessionToDelete);

        await dbDeleteSession(sessionId);

        if (get().currentSessionId === sessionId) {
            void navigate(prevId ? `/chat/${prevId}` : '/chat/new');
        } else {
            const currentId = get().currentSessionId;
            if (currentId) {
                void get().loadSession(currentId);
            }
        }
    },
});