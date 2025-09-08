import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { NavigateFunction } from 'react-router-dom';
import {
  getAllSessionKeysSortedByUpdate,
  loadSession,
  saveSession,
  deleteSession as dbDeleteSession,
} from '@/services/persistence';
import { listAvailableModels, requestMessageContentStreamed } from '@/api/openrouter';
import type { ChatSession, Message } from '@/types/chat';
import type { DisplayModelInfo, SystemPrompt } from '@/types/storage';

// Helper to get the current system prompt object
const getCurrentSystemPrompt = (prompts: SystemPrompt[], name: string | null): SystemPrompt | null => {
    if (!name) return null;
    return prompts.find(p => p.name === name) || null;
};


interface AppState {
  // --- Persisted State (in Local Storage) ---
  apiKey: string;
  systemPrompts: SystemPrompt[];
  modelName: string;
  cachedModels: DisplayModelInfo[];
  input: string;
  selectedPromptName: string | null;

  // --- Session State (in IndexedDB, managed by actions) ---
  messages: Message[];
  currentSessionId: string | null;
  sortedSessionIds: string[];
  
  // --- Transient State ---
  error: string | null;
  modelsLoading: boolean;
  modelsError: string | null;
  isStreaming: boolean;
  streamController: AbortController | null;
  initialChatPrompt: string | null;

  // --- Actions ---
  setApiKey: (key: string) => void;
  setSystemPrompts: (prompts: SystemPrompt[]) => void;
  setModelName: (name: string) => void;
  setInput: (text: string) => void;
  setSelectedPromptName: (name: string | null) => void;

  setError: (error: string | null) => void;
  setInitialChatPrompt: (prompt: string | null) => void;
  
  loadSession: (sessionId: string | 'new') => Promise<void>;
  startNewSession: () => void;
  saveCurrentSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  fetchSessionList: () => Promise<void>;

  fetchModelList: () => Promise<void>;
  
  // Core chat actions
  submitMessage: (options: { promptOverride?: string; navigate?: NavigateFunction }) => Promise<void>;
  regenerateMessage: (index: number) => Promise<void>;
  editAndResubmitMessage: (index: number, newContent: string) => Promise<void>;
  cancelStream: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // --- Persisted State ---
      apiKey: '',
      systemPrompts: [],
      modelName: 'openai/gpt-4o',
      cachedModels: [],
      input: '',
      selectedPromptName: null,

      // --- Session State ---
      messages: [],
      currentSessionId: null,
      sortedSessionIds: [],
      
      // --- Transient State ---
      error: null,
      modelsLoading: false,
      modelsError: null,
      isStreaming: false,
      streamController: null,
      initialChatPrompt: null,

      // --- Actions ---
      setApiKey: (apiKey) => set({ apiKey }),
      setSystemPrompts: (systemPrompts) => set({ systemPrompts }),
      setModelName: (modelName) => set({ modelName }),
      setInput: (input) => set({ input }),
      setSelectedPromptName: (selectedPromptName) => set({ selectedPromptName }),

      setError: (error) => {
        if (error) {
          console.error(`[App Error] ${error}`);
        }
        set({ error });
      },

      setInitialChatPrompt: (prompt) => set({ initialChatPrompt: prompt }),
      
      loadSession: async (sessionId) => {
        if (get().currentSessionId === sessionId) {
            return; // Session is already in memory, no need to load.
        }
        set({ error: null });
        if (sessionId === 'new') {
          get().startNewSession();
          return;
        }
        
        try {
          const session = await loadSession(sessionId);
          if (session) {
            set({
              messages: session.messages,
              currentSessionId: session.session_id,
              selectedPromptName: session.prompt_name,
            });
          } else {
            get().setError(`Session ${sessionId} not found.`);
            get().startNewSession(); 
          }
        } catch (e) {
          console.error(e);
          get().setError('Failed to load session.');
        }
      },
      
      startNewSession: () => {
        set({
          messages: [],
          currentSessionId: null,
        });
      },
      
      fetchSessionList: async () => {
        const sortedSessionIds = await getAllSessionKeysSortedByUpdate();
        set({ sortedSessionIds });
      },

      saveCurrentSession: async () => {
        const { currentSessionId, messages, selectedPromptName } = get();
        if (messages.length === 0 || !currentSessionId) return;

        const existingSession = await loadSession(currentSessionId);

        const session: ChatSession = {
          session_id: currentSessionId,
          messages,
          prompt_name: selectedPromptName,
          created_at_ms: existingSession?.created_at_ms || Date.now(),
          updated_at_ms: Date.now(),
          name: existingSession?.name || null,
        };
        await saveSession(session);
        await get().fetchSessionList(); // Refresh list after saving
      },

      deleteSession: async (sessionId) => {
        await dbDeleteSession(sessionId);
        await get().fetchSessionList();
        if (get().currentSessionId === sessionId) {
          get().startNewSession();
        }
      },

      fetchModelList: async () => {
        if (get().apiKey) {
            set({ modelsLoading: true, modelsError: null });
            try {
              const models = await listAvailableModels();
              set({ cachedModels: models, modelsLoading: false });
            } catch (e) {
              const error = e instanceof Error ? e.message : 'An unknown error occurred.';
              console.error(`[Model Fetch Error] ${error}`);
              set({ modelsError: error, modelsLoading: false });
            }
        }
      },

      // --- Core Chat Actions ---
      submitMessage: async ({ promptOverride, navigate }) => {
        const { input, apiKey, modelName, messages, systemPrompts, selectedPromptName } = get();
        const content = promptOverride || input;
        if (!content || !apiKey) return;

        let sessionId = get().currentSessionId;
        const isNewSession = !sessionId;
        if (isNewSession) {
            sessionId = uuidv4();
            set({ currentSessionId: sessionId });
        }

        const newMessages: Message[] = [];
        const systemPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
        if (messages.length === 0 && systemPrompt) {
            newMessages.push({
                role: 'system',
                content: systemPrompt.prompt,
                prompt_name: systemPrompt.name,
                model_name: null, cost: null
            });
        }
        
        newMessages.push({ role: 'user', content, prompt_name: null, model_name: null, cost: null });

        set((state) => ({ messages: [...state.messages, ...newMessages], input: '' }));
        
        // Navigate after the first message if it's a new session
        if (isNewSession && navigate && sessionId) {
            navigate(`/chat/${sessionId}`, { replace: true });
        }

        const messagesToSubmit = get().messages;
        set({ isStreaming: true, error: null });

        const controller = new AbortController();
        set({ streamController: controller });

        try {
            const stream = await requestMessageContentStreamed(
                messagesToSubmit,
                modelName,
                apiKey
            );

            set((state) => ({ 
                messages: [...state.messages, { role: 'assistant', content: '', model_name: modelName, cost: null, prompt_name: null }] 
            }));

            for await (const chunk of stream) {
                if (controller.signal.aborted) {
                  stream.controller.abort();
                  break;
                }
                const contentChunk = chunk.choices[0]?.delta?.content || '';
                 set((state) => {
                    if (state.messages.length === 0 || state.messages[state.messages.length - 1].role !== 'assistant') {
                        return state;
                    }
                    const lastMessage = state.messages[state.messages.length - 1];
                    const updatedMessage = { ...lastMessage, content: lastMessage.content + contentChunk };
                    return { messages: [...state.messages.slice(0, -1), updatedMessage] };
                });
            }
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(error);
            // Remove the placeholder assistant message on error
            set(state => ({ messages: state.messages.slice(0, -1) }));
        } finally {
            set({ isStreaming: false, streamController: null });
            await get().saveCurrentSession();
        }
      },

      regenerateMessage: async (index) => {
        const messagesToRegenerate = get().messages.slice(0, index);
        const lastUserMessage = messagesToRegenerate.reverse().find(m => m.role === 'user');
        
        set({ messages: get().messages.slice(0, index) }); // Trim history

        if (lastUserMessage) {
            // Since this is an internal call, we don't need to navigate.
            await get().submitMessage({ promptOverride: lastUserMessage.content });
        }
      },

      editAndResubmitMessage: async (index, newContent) => {
        const newMessages = [...get().messages];
        newMessages[index] = { ...newMessages[index], content: newContent };
        
        set({ messages: newMessages.slice(0, index + 1) });
        await get().submitMessage({ promptOverride: newContent });
      },
      
      cancelStream: () => {
        get().streamController?.abort();
      },

    }),
    {
      name: 'tomatic-storage', 
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        apiKey: state.apiKey,
        systemPrompts: state.systemPrompts,
        modelName: state.modelName,
        cachedModels: state.cachedModels,
        input: state.input,
        selectedPromptName: state.selectedPromptName,
      }),
    }
  )
);
