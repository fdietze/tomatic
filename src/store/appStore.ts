import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { NavigateFunction } from 'react-router-dom';
import {
  findNeighbourSessionIds,
  getMostRecentSessionId,
  loadSession,
  saveSession,
  deleteSession as dbDeleteSession,
  saveSystemPrompt,
  loadAllSystemPrompts,
  deleteSystemPrompt as dbDeleteSystemPrompt,
} from '@/services/persistence';
import { listAvailableModels, requestMessageContentStreamed } from '@/api/openrouter';
import type { ChatSession, Message } from '@/types/chat';
import type { DisplayModelInfo, SystemPrompt } from '@/types/storage';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

const STORAGE_KEY = 'tomatic-storage';

// --- One-Time LocalStorage Migration ---
// This function checks for data from the old, non-Zustand version of the app
// and migrates it to the new Zustand-managed format.
const runLocalStorageMigration = () => {
  if (localStorage.getItem(STORAGE_KEY)) {
    // New storage format already exists, no migration needed.
    return;
  }

  const oldApiKey = localStorage.getItem('OPENROUTER_API_KEY');
  if (!oldApiKey) {
    // No sign of old data, nothing to migrate.
    return;
  }

  console.log('[Migration] Migrating old localStorage data to new format...');

  try {
    const oldState = {
      apiKey: oldApiKey || '',
      modelName: localStorage.getItem('MODEL_NAME') || 'google/gemini-2.5-pro',
      systemPrompts: JSON.parse(localStorage.getItem('system_prompts') || '[]'),
      cachedModels: JSON.parse(localStorage.getItem('cached_models') || '[]'),
      input: localStorage.getItem('input') || '',
      selectedPromptName: JSON.parse(localStorage.getItem('selected_prompt_name') || 'null'),
    };

    const newState = {
      state: oldState,
      version: 0, 
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));

    // Clean up old keys
    localStorage.removeItem('OPENROUTER_API_KEY');
    localStorage.removeItem('MODEL_NAME');
    localStorage.removeItem('system_prompts');
    localStorage.removeItem('cached_models');
    localStorage.removeItem('input');
    localStorage.removeItem('selected_prompt_name');
    
    console.log('[Migration] Migration successful.');

  } catch (error) {
    console.error('[Migration] Failed to migrate localStorage:', error);
    // If migration fails, it's safer to clear the broken old keys
    // to prevent a broken state on next load.
    localStorage.removeItem('OPENROUTER_API_KEY');
    localStorage.removeItem('MODEL_NAME');
    localStorage.removeItem('system_prompts');
    localStorage.removeItem('cached_models');
    localStorage.removeItem('input');
    localStorage.removeItem('selected_prompt_name');
  }
};

// Run the migration before the store is created.
runLocalStorageMigration();


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
  autoScrollEnabled: boolean;

  // --- Session State (in IndexedDB, managed by actions) ---
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;

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
  toggleAutoScroll: () => void;

  setError: (error: string | null) => void;
  setInitialChatPrompt: (prompt: string | null) => void;
  
  loadSession: (sessionId: string | 'new') => Promise<void>;
  startNewSession: () => void;
  saveCurrentSession: () => Promise<void>;
  deleteSession: (sessionId: string, navigate: NavigateFunction) => Promise<void>;
  loadSystemPrompts: () => Promise<void>;
  addSystemPrompt: (prompt: SystemPrompt) => Promise<void>;
  updateSystemPrompt: (oldName: string, prompt: SystemPrompt) => Promise<void>;
  deleteSystemPrompt: (name: string) => Promise<void>;

  fetchModelList: () => Promise<void>;
  
  // Core chat actions
  submitMessage: (options: {
    promptOverride?: string;
    navigate?: NavigateFunction;
    isRegeneration?: boolean;
    messagesToRegenerate?: Message[];
  }) => Promise<void>;
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
      modelName: 'google/gemini-2.5-pro',
      cachedModels: [],
      input: '',
      selectedPromptName: null,
      autoScrollEnabled: false,

      // --- Session State ---
      messages: [],
      currentSessionId: null,
      prevSessionId: null,
      nextSessionId: null,

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
      setSelectedPromptName: (selectedPromptName) => {
        const { systemPrompts, messages } = get();
        const newPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
        const newMessages = [...messages];

        const systemMessageIndex = newMessages.findIndex((m) => m.role === 'system');

        if (newPrompt) {
          const newSystemMessage: Message = {
            id: uuidv4(),
            role: 'system',
            content: newPrompt.prompt,
            prompt_name: newPrompt.name,
            model_name: null,
            cost: null,
          };
          if (systemMessageIndex !== -1) {
            // Replace existing system message
            newMessages[systemMessageIndex] = newSystemMessage;
          } else {
            // Add new system message to the beginning
            newMessages.unshift(newSystemMessage);
          }
        } else if (systemMessageIndex !== -1) {
          // Remove system message if prompt is deselected
          newMessages.splice(systemMessageIndex, 1);
        }

        set({ selectedPromptName, messages: newMessages });
      },

      setError: (error) => {
        if (error) {
          console.error(`[App Error] ${error}`);
        }
        set({ error });
      },

      setInitialChatPrompt: (prompt) => set({ initialChatPrompt: prompt }),
      
      loadSession: async (sessionId) => {
        // This check MUST come first to prevent wiping state during navigation race conditions.
        if (get().currentSessionId === sessionId && sessionId !== 'new') {
          return;
        }

        if (get().isStreaming) {
          get().cancelStream();
        }

        if (get().currentSessionId === sessionId && sessionId !== 'new') {
          return; // Session is already in memory, no need to load.
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
            const { prevId, nextId } = await findNeighbourSessionIds(session);
            set({
              messages: session.messages,
              currentSessionId: session.session_id,
              selectedPromptName: systemMessage?.prompt_name || null,
              prevSessionId: prevId,
              nextSessionId: nextId,
            });
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
        // No longer need to fetch the whole list after saving
      },

      deleteSession: async (sessionId, navigate) => {
        const sessionToDelete = await loadSession(sessionId);
        if (!sessionToDelete) return;

        // Find neighbors before deleting to know where to navigate next.
        const { prevId } = await findNeighbourSessionIds(sessionToDelete);

        await dbDeleteSession(sessionId);

        if (get().currentSessionId === sessionId) {
          // Navigate to the next older session, or to 'new' if it was the oldest.
          navigate(prevId ? `/chat/${prevId}` : '/chat/new');
        } else {
          // If we deleted a background session, we might need to update the
          // current session's neighbor state if the deleted one was a neighbor.
          const currentId = get().currentSessionId;
          if (currentId) {
            await get().loadSession(currentId);
          }
        }
      },

      loadSystemPrompts: async () => {
        try {
          const prompts = await loadAllSystemPrompts();
          set({ systemPrompts: prompts });
        } catch (e) {
          const error = e instanceof Error ? e.message : 'An unknown error occurred.';
          get().setError(`Failed to load system prompts: ${error}`);
        }
      },

      addSystemPrompt: async (prompt) => {
        try {
          await saveSystemPrompt(prompt);
          // Refresh the prompts from the source of truth
          await get().loadSystemPrompts();
        } catch (e) {
          const error = e instanceof Error ? e.message : 'An unknown error occurred.';
          get().setError(`Failed to add system prompt: ${error}`);
        }
      },
      
      updateSystemPrompt: async (oldName, prompt) => {
        try {
          // In IndexedDB with a keyPath, updating an item with a new key
          // requires deleting the old one and adding the new one.
          if (oldName !== prompt.name) {
            await dbDeleteSystemPrompt(oldName);
          }
          await saveSystemPrompt(prompt);
          await get().loadSystemPrompts();
        } catch (e) {
          const error = e instanceof Error ? e.message : 'An unknown error occurred.';
          get().setError(`Failed to update system prompt: ${error}`);
        }
      },

      deleteSystemPrompt: async (name) => {
        try {
          await dbDeleteSystemPrompt(name);
          await get().loadSystemPrompts();
        } catch (e) {
          const error = e instanceof Error ? e.message : 'An unknown error occurred.';
          get().setError(`Failed to delete system prompt: ${error}`);
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
      submitMessage: async ({ promptOverride, navigate, isRegeneration, messagesToRegenerate }) => {
        const { input, apiKey, modelName, systemPrompts, selectedPromptName } = get();
        const content = promptOverride || input;
        if (!content || !apiKey) return;

        console.log('[DEBUG] submitMessage START. Content:', content);

        let sessionId = get().currentSessionId;
        const isNewSession = !sessionId;
        if (isNewSession) {
            sessionId = uuidv4();
            // The new session object is created in saveCurrentSession, which is called
            // in the finally block. We just need to ensure the session ID is set.
            set({ currentSessionId: sessionId });
        }

        const newMessages: Message[] = [];
        const systemPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
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
            newMessages.push({ id: uuidv4(), role: 'user', content, prompt_name: null, model_name: null, cost: null });
        }

        if (newMessages.length > 0) {
          console.log('[DEBUG] submitMessage (existing session): adding user message. Current message count:', get().messages.length);
          set((state) => ({ messages: [...state.messages, ...newMessages], input: '' }));
          console.log('[DEBUG] submitMessage (existing session): after adding user message. New message count:', get().messages.length);
        }
        
        // Navigate after the first message if it's a new session
        if (isNewSession && navigate && sessionId) {
            console.log(`[DEBUG] submitMessage (new session): Navigating to /chat/${sessionId}`);
            navigate(`/chat/${sessionId}`, { replace: true });
        }

        const messagesToSubmit = messagesToRegenerate || get().messages;
        console.log('[DEBUG] submitMessage: messagesToSubmit count:', messagesToSubmit.length, 'Content:', JSON.stringify(messagesToSubmit.map(m => m.content)));
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
            console.log('[DEBUG] submitMessage: Assistant placeholder added. Total messages:', get().messages.length);

            console.log('[DEBUG] submitMessage: Entering stream processing loop...');
            let finalChunk: ChatCompletionChunk | undefined;
            for await (const chunk of stream) {
                finalChunk = chunk;
                console.log('[DEBUG] submitMessage: Received stream chunk.');
                if (controller.signal.aborted) {
                  stream.controller.abort();
                  break;
                }
                const contentChunk = chunk.choices[0]?.delta?.content || '';
                 set((state) => {
                    if (state.messages.length === 0 || state.messages[state.messages.length - 1].role !== 'assistant') {
                        console.log('[DEBUG] submitMessage stream: bailing out, no assistant message found at the end.');
                        return state;
                    }
                    const lastMessage = state.messages[state.messages.length - 1];
                    const updatedMessage = { ...lastMessage, content: lastMessage.content + contentChunk };
                    return { messages: [...state.messages.slice(0, -1), updatedMessage] };
                });
            }
            
            if (finalChunk?.usage) {
              console.log('[DEBUG] submitMessage: Final stream chunk:', finalChunk);
              console.log('[DEBUG] submitMessage: Usage data:', finalChunk.usage);
              const { prompt_tokens, completion_tokens } = finalChunk.usage;
              const { cachedModels, modelName } = get();
              const modelInfo = cachedModels.find(m => m.id === modelName);

              if (modelInfo && prompt_tokens && completion_tokens) {
                const promptCost = (prompt_tokens / 1_000_000) * (modelInfo.prompt_cost_usd_pm || 0);
                const completionCost = (completion_tokens / 1_000_000) * (modelInfo.completion_cost_usd_pm || 0);

                set(state => {
                  const lastMessage = state.messages[state.messages.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
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

            // --- Finalization logic moved from finally block ---
            console.log('[DEBUG] submitMessage stream finished. isStreaming:', get().isStreaming);
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
            console.log(`[DEBUG] submitMessage error: ${error}`);
            // Remove the placeholder assistant message on error
            set(state => ({ messages: state.messages.filter(m => m.role !== 'assistant' || m.content !== '') }));
             // Also need to reset streaming state on error
            set({ isStreaming: false, streamController: null });
        }
      },

      regenerateMessage: async (index) => {
        console.log(`[DEBUG] regenerateMessage called for index: ${index}`);
        const { messages, systemPrompts } = get();
        const messagesToRegenerate = [...messages.slice(0, index)]; // Create a mutable copy

        // Find the system message to check if its prompt needs updating
        const systemMessageIndex = messagesToRegenerate.findIndex(m => m.role === 'system');
        if (systemMessageIndex !== -1) {
          const systemMessage = messagesToRegenerate[systemMessageIndex];
          const latestPrompt = systemPrompts.find(p => p.name === systemMessage.prompt_name);

          // If the prompt still exists and its content has changed, update the message
          if (latestPrompt && latestPrompt.prompt !== systemMessage.content) {
            console.log(`[DEBUG] Found updated prompt "${latestPrompt.name}". Updating content for regeneration.`);
            messagesToRegenerate[systemMessageIndex] = { ...systemMessage, content: latestPrompt.prompt };
          }
        }

        console.log('[DEBUG] regenerateMessage: messagesToRegenerate (after update)', JSON.stringify(messagesToRegenerate.map(m => m.content)));
        
        const lastUserMessage = [...messagesToRegenerate].reverse().find((m) => m.role === 'user');
        
        if (lastUserMessage) {
            // Since this is an internal call, we don't need to navigate.
            await get().submitMessage({ 
              promptOverride: lastUserMessage.content, 
              isRegeneration: true, 
              messagesToRegenerate 
            });
        }
      },

      editAndResubmitMessage: async (index, newContent) => {
        const newMessages = [...get().messages];
        newMessages[index] = { ...newMessages[index], content: newContent };
        
        set({ messages: newMessages.slice(0, index + 1) });
        await get().submitMessage({ promptOverride: newContent, isRegeneration: true });
      },
      
      cancelStream: () => {
        get().streamController?.abort();
      },

      toggleAutoScroll: () => set((state) => ({ autoScrollEnabled: !state.autoScrollEnabled })),

    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1, // Start versioning our state
      migrate: async (persistedState, version) => {
        if (version === 0) {
          // In this specific case, the migration from v0 to v1 requires no changes,
          // as the initial migration script already shapes the data correctly for v1.
          // This block is here to establish the pattern for future migrations.
          const oldState = persistedState as Partial<AppState>;
          if (oldState.systemPrompts && Array.isArray(oldState.systemPrompts)) {
            console.log('[Migration] Migrating system prompts from localStorage to IndexedDB...');
            try {
              const promptsToMigrate = oldState.systemPrompts;
              for (const prompt of promptsToMigrate) {
                // This will overwrite existing prompts with the same name if any.
                await saveSystemPrompt(prompt);
              }
              console.log(`[Migration] Successfully migrated ${promptsToMigrate.length} prompts.`);
              // We don't need to remove systemPrompts from oldState because
              // the `partialize` function below will prevent it from being
              // re-persisted into localStorage on the next save.
            } catch (error) {
              console.error('[Migration] Failed to migrate system prompts:', error);
            }
          }
        }
        return persistedState as AppState;
      },
      partialize: (state) => ({
        apiKey: state.apiKey,
        modelName: state.modelName,
        cachedModels: state.cachedModels,
        input: state.input,
        selectedPromptName: state.selectedPromptName,
        autoScrollEnabled: state.autoScrollEnabled,
      }),
    }
  )
);
