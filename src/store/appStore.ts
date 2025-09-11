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

interface OldState {
  apiKey: string;
  modelName: string;
  systemPrompts: unknown[];
  cachedModels: unknown[];
  input: string;
  selectedPromptName: unknown;
}

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

  console.debug('[Migration] Migrating old localStorage data to new format...');

  try {
    const oldState: OldState = {
      apiKey: oldApiKey || '',
      modelName: localStorage.getItem('MODEL_NAME') || 'google/gemini-2.5-pro',
      systemPrompts: JSON.parse(localStorage.getItem('system_prompts') || '[]') as unknown[],
      cachedModels: JSON.parse(localStorage.getItem('cached_models') || '[]') as unknown[],
      input: localStorage.getItem('input') || '',
      selectedPromptName: JSON.parse(localStorage.getItem('selected_prompt_name') || 'null') as unknown,
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
    
    console.debug('[Migration] Migration successful.');

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
  isInitializing: boolean;

  // --- Actions ---
  setApiKey: (key: string) => void;
  setSystemPrompts: (prompts: SystemPrompt[]) => void;
  setModelName: (name: string) => void;
  setInput: (text: string) => void;
  setSelectedPromptName: (name: string | null) => void;
  toggleAutoScroll: () => void;

  setError: (error: string | null) => void;
  
  loadSession: (sessionId: string, initialPrompt?: string, navigate?: NavigateFunction) => Promise<void>;
  startNewSession: (initialPrompt?: string, navigate?: NavigateFunction) => Promise<void>;
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
  init: () => void;
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
      isInitializing: true,

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
          console.error(`[STORE|setError] ${error}`);
        }
        set({ error });
      },
      
      loadSession: async (sessionId, initialPrompt, navigate) => {
        const { currentSessionId, messages } = get();

        // If we are asked to load the same session, do nothing.
        if (currentSessionId === sessionId && sessionId !== 'new') {
          return;
        }

        // If we are asked to load 'new' but we already have a session ID and some messages,
        // it means we are in the middle of a new session creation from a prompt.
        // The re-render from clearing search params is causing this. We should ignore it.
        if (sessionId === 'new' && !initialPrompt && currentSessionId && messages.length > 0) {
          console.debug('[STORE|loadSession] Ignoring redundant "new" session load.');
          return;
        }

        console.debug(`[STORE|loadSession] Loading session: ${sessionId}`);
        if (get().isStreaming) {
          get().cancelStream();
        }

        set({ error: null, messages: [], currentSessionId: sessionId });

        if (sessionId === 'new') {
          await get().startNewSession(initialPrompt, navigate);
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
      
      startNewSession: async (initialPrompt, navigate) => {
        const mostRecentId = await getMostRecentSessionId();
        const { systemPrompts, selectedPromptName, setSelectedPromptName } = get();
        const systemPrompt = getCurrentSystemPrompt(systemPrompts, selectedPromptName);
        console.debug(`[STORE|startNewSession] Starting new session. Most recent was: ${String(mostRecentId)}`);
        
        const initialMessages: Message[] = [];
        // If there's an initial prompt, we don't want to use the stored system prompt
        if (systemPrompt && !initialPrompt) {
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

        // If there's an initial prompt, deselect the system prompt and submit the message
        if (initialPrompt) {
          setSelectedPromptName(null);
          await get().submitMessage({ promptOverride: initialPrompt, navigate });
        }
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
          void navigate(prevId ? `/chat/${prevId}` : '/chat/new');
        } else {
          // If we deleted a background session, we might need to update the
          // current session's neighbor state if the deleted one was a neighbor.
          const currentId = get().currentSessionId;
          if (currentId) {
            void get().loadSession(currentId);
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
        set({ modelsLoading: true, modelsError: null });
        console.debug('[STORE|fetchModelList] Fetching model list...');
        try {
          const models = await listAvailableModels();
          set({ cachedModels: models, modelsLoading: false });
        } catch (e) {
          const error = e instanceof Error ? e.message : 'An unknown error occurred.';
          console.error(`[STORE|fetchModelList] Failed to fetch models: ${error}`);
          set({ modelsError: error, modelsLoading: false });
        }
      },

      // --- Core Chat Actions ---
      submitMessage: async ({ promptOverride, navigate, isRegeneration, messagesToRegenerate }) => {
        const { input, apiKey, modelName, systemPrompts, selectedPromptName } = get();
        const content = promptOverride || input;
        if (!content || !apiKey) return;

        console.debug(`[STORE|submitMessage] Start. Is regeneration: ${String(isRegeneration)}`);

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
          console.debug(`[STORE|submitMessage] Adding ${String(newMessages.length)} new message(s) to state.`);
          set((state) => ({ messages: [...state.messages, ...newMessages], input: '' }));
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

            // --- Finalization logic moved from finally block ---
            console.debug('[STORE|submitMessage] Stream finished.');
            set({ isStreaming: false, streamController: null });
            await get().saveCurrentSession();

            // Navigate after saving if it was a new session
            if (isNewSession && navigate && sessionId) {
              console.debug(`[STORE|submitMessage] New session, navigating to /chat/${sessionId}`);
              void navigate(`/chat/${sessionId}`, { replace: true });
            }

            const currentId = get().currentSessionId;
            if (currentId) {
                const currentSession = await loadSession(currentId);
                if (currentSession) {
                    const { prevId, nextId } = await findNeighbourSessionIds(currentSession);
                    set({ prevSessionId: prevId, nextSessionId: nextId });
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e.message : 'An unknown error occurred.';
            get().setError(error);
            // Remove the placeholder assistant message on error
            set(state => ({ messages: state.messages.filter(m => m.role !== 'assistant' || m.content !== '') }));
             // Also need to reset streaming state on error
            set({ isStreaming: false, streamController: null });
        }
      },

      regenerateMessage: async (index) => {
        console.debug(`[STORE|regenerateMessage] Called for index: ${String(index)}`);
        const { messages, systemPrompts } = get();
        const messagesToRegenerate = [...messages.slice(0, index)]; // Create a mutable copy

        // Find the system message to check if its prompt needs updating
        const systemMessageIndex = messagesToRegenerate.findIndex(m => m.role === 'system');
        if (systemMessageIndex !== -1) {
          const systemMessage = messagesToRegenerate[systemMessageIndex];
          const latestPrompt = systemPrompts.find(p => p.name === systemMessage.prompt_name);

          // If the prompt still exists and its content has changed, update the message
          if (latestPrompt && latestPrompt.prompt !== systemMessage.content) {
            console.debug(`[STORE|regenerateMessage] Found updated prompt "${latestPrompt.name}". Updating content for regeneration.`);
            messagesToRegenerate[systemMessageIndex] = { ...systemMessage, content: latestPrompt.prompt };
          }
        }
        
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

      init: () => {
        console.debug('[STORE|init] Starting application initialization.');
        Promise.all([get().loadSystemPrompts(), get().fetchModelList()])
          .then(() => {
            console.debug('[STORE|init] System prompts and model list loaded successfully.');
            set({ isInitializing: false });
          })
          .catch((error: unknown) => {
            console.error('[STORE|init] Initialization failed:', error);
            // We can still finish initializing, but show an error.
            get().setError('Initialization failed. Some features may not be available.');
            set({ isInitializing: false });
          });
      },

    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1, // Start versioning our state
      migrate: async (persistedState, version) => {
        if (version === 0) {
          // In this specific case, the migration from v0 to v1 requires no changes,
          // as the initial migration script already shapes the data correctly for v1.
          const oldState = persistedState as Partial<AppState>;
          if (oldState.systemPrompts && Array.isArray(oldState.systemPrompts)) {
            console.debug('[Migration] Migrating system prompts from localStorage to IndexedDB...');
            try {
              const promptsToMigrate = oldState.systemPrompts;
              for (const prompt of promptsToMigrate) {
                // This will overwrite existing prompts with the same name if any.
                await saveSystemPrompt(prompt);
              }
              console.debug(`[Migration] Successfully migrated ${String(promptsToMigrate.length)} prompts.`);
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
