import type { NavigateFunction } from 'react-router-dom';
import type { Message } from '@/types/chat';
import type { DisplayModelInfo, Snippet, SystemPrompt } from '@/types/storage';

// --- Slice Interfaces ---

export interface SettingsSlice {
  apiKey: string;
  modelName: string;
  input: string;
  selectedPromptName: string | null;
  autoScrollEnabled:boolean;
  setApiKey: (key: string) => void;
  setModelName: (name: string) => void;
  setInput: (text: string) => void;
  setSelectedPromptName: (name: string | null) => void;
  toggleAutoScroll: () => void;
}

export interface UtilitySlice {
    error: string | null;
    isInitializing: boolean;
    initialChatPrompt: string | null;
    setError: (error: string | null) => void;
    setInitialChatPrompt: (prompt: string | null) => void;
    init: () => void;
}

export interface ModelsSlice {
    cachedModels: DisplayModelInfo[];
    modelsLoading: boolean;
    modelsError: string | null;
    fetchModelList: () => Promise<void>;
}

export interface SessionSlice {
  messages: Message[];
  currentSessionId: string | null;
  prevSessionId: string | null;
  nextSessionId: string | null;

  loadSession: (sessionId: string) => Promise<void>;
  startNewSession: () => Promise<void>;
  saveCurrentSession: () => Promise<void>;
  deleteSession: (sessionId: string, navigate: NavigateFunction) => Promise<void>;
}

export interface SystemPromptsSlice {
  systemPrompts: SystemPrompt[];
  loadSystemPrompts: () => Promise<void>;
  addSystemPrompt: (prompt: SystemPrompt) => Promise<void>;
  updateSystemPrompt: (oldName: string, prompt: SystemPrompt) => Promise<void>;
  deleteSystemPrompt: (name: string) => Promise<void>;
  setSystemPrompts: (prompts: SystemPrompt[]) => void;
}

export interface SnippetsSlice {
  snippets: Snippet[];
  loadSnippets: () => Promise<void>;
  addSnippet: (snippet: Snippet) => Promise<void>;
  updateSnippet: (oldName: string, snippet: Snippet) => Promise<void>;
  deleteSnippet: (name: string) => Promise<void>;
  generateSnippetContent: (snippet: Snippet) => Promise<Snippet>;
  regenerateDependentSnippets: (updatedSnippetName: string) => Promise<void>;
}

export interface ChatSlice {
  isStreaming: boolean;
  streamController: AbortController | null;
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

// --- Combined AppState ---

export interface AppState
  extends SettingsSlice,
    UtilitySlice,
    ModelsSlice,
    SessionSlice,
    SystemPromptsSlice,
    SnippetsSlice,
    ChatSlice {}

