import { AppError } from './errors';

export interface SystemPrompt {
  name: string;
  prompt: string;
}

export interface DisplayModelInfo {
  id: string;
  name: string;
  prompt_cost_usd_pm: number | null;
  completion_cost_usd_pm: number | null;
}

// req:snippet-id-vs-name, req:snippet-dirty-indexeddb, req:snippet-error-propagation
export interface Snippet {
  id: string; // req:snippet-id-vs-name: Primary key for identification
  name: string; // req:snippet-id-vs-name: Unique name for referencing
  content: string;
  isGenerated: boolean; // Must be a required boolean
  prompt?: string;
  model?: string;
  createdAt_ms: number;
  updatedAt_ms: number;
  generationError: AppError | null; // req:snippet-error-propagation: Store generation errors
  isDirty: boolean; // req:snippet-dirty-indexeddb: Flag for resuming generation on reload
}

// ================================================================================================
// Versioned Storage Types
// ================================================================================================

// This file serves as a single source of truth for the schemas of all storage layers,
// providing a clear history of how they have evolved.

// ------------------------------------------------------------------------------------------------
// LocalStorage
// ------------------------------------------------------------------------------------------------

export interface LocalStoragePersistedState<T> {
  state: T;
  version: number;
}

// v0: The state shape before Zustand, and during the v0 phase of Zustand persistence.
export interface LocalStorageV0State {
  apiKey: string;
  modelName: string;
  systemPrompts: unknown[];
  cachedModels: unknown[];
  input: string;
  selectedPromptName: unknown;
  autoScrollEnabled?: boolean; // This was added later in the v0 lifecycle
}

// v1: The deployed state shape with cachedModels and input fields
export interface LocalStorageV1State {
  apiKey: string;
  modelName: string;
  cachedModels: DisplayModelInfo[];
  input: string;
  selectedPromptName: string | null;
  autoScrollEnabled: boolean;
}

// v2: The current state shape - removed cachedModels and input, added initialChatPrompt
export interface LocalStorageV2State {
  apiKey: string;
  modelName: string;
  selectedPromptName: string | null;
  autoScrollEnabled: boolean;
  initialChatPrompt: string | null;
}

export type LocalStorageCurrent = LocalStoragePersistedState<LocalStorageV2State>;

// ------------------------------------------------------------------------------------------------
// IndexedDB
// ------------------------------------------------------------------------------------------------

// To ensure schema history is immutable, each version namespace defines its own types,
// preventing changes to the current `chat.ts` or `storage.ts` types from affecting
// our historical record of the database schema.

export interface DBV1_MessageCost {
  prompt: number;
  completion: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface DBV1_Message {
  // Note: `id` and `prompt_name` were not guaranteed in V1
  id?: string;
  prompt_name?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  raw_content?: string;
  model_name?: string | null;
  cost?: DBV1_MessageCost | null;
}

export interface DBV1_ChatSession {
  session_id: string;
  messages: DBV1_Message[];
  // Note: `name` was not present in V1
  name?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DBV2_MessageCost {
  prompt: number;
  completion: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface DBV2_Message {
  id: string; // Became required in V2
  prompt_name: string | null; // Became required in V2
  role: 'user' | 'assistant' | 'system';
  content: string;
  raw_content?: string;
  model_name?: string | null;
  cost?: DBV2_MessageCost | null;
}

export interface DBV2_ChatSession {
  session_id: string;
  messages: DBV2_Message[];
  name: string | null; // Became required in V2
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DBV2_SystemPrompt {
  name: string;
  prompt: string;
}

// Snippets did not exist in V2, but we include an empty interface for completeness.
// We also define a V2 snippet type to represent the state *before* the V3 migration ran.
export interface DBV2_V2SnippetOnDisk {
  name: string;
  content: string;
  isGenerated: boolean;
  prompt?: string;
  model?: string;
}

export interface DBV3_MessageCost {
  prompt: number;
  completion: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface DBV3_Message {
  id: string;
  prompt_name: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  raw_content?: string;
  model_name?: string | null;
  cost?: DBV3_MessageCost | null;
}

export interface DBV3_ChatSession {
  session_id: string;
  messages: DBV3_Message[];
  name: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface DBV3_SystemPrompt {
  name: string;
  prompt: string;
}

export interface DBV3_Snippet {
  id: string;
  name: string;
  content: string;
  isGenerated: boolean;
  prompt?: string;
  model?: string;
  createdAt_ms: number;
  updatedAt_ms: number;
  generationError: AppError | null;
  isDirty: boolean;
}

// --- Seeding Data Types ---

export interface IndexedDBDataV1 {
  chat_sessions: DBV1_ChatSession[];
}

export interface IndexedDBDataV2 {
  chat_sessions: DBV2_ChatSession[];
  system_prompts: DBV2_SystemPrompt[];
  snippets: DBV2_V2SnippetOnDisk[];
}

export interface IndexedDBDataV3 {
  chat_sessions: DBV3_ChatSession[];
  system_prompts: DBV3_SystemPrompt[];
  snippets: DBV3_Snippet[];
}

export type IndexedDBDataCurrent = IndexedDBDataV3;
