/**
 * Specific action payload types to replace generic Partial<T> usage.
 * This improves type safety by ensuring only valid combinations of fields can be updated.
 */

import { DisplayModelInfo, SystemPrompt } from './storage';
import { Message } from './chat';
import { AppError } from './errors';

// Settings-related payloads
export interface LoadSettingsSuccessPayload {
  apiKey?: string;
  modelName?: string;
  autoScrollEnabled?: boolean;
  selectedPromptName?: string | null;
  initialChatPrompt?: string | null;
}

export interface SaveSettingsPayload {
  apiKey?: string;
  modelName?: string;
  autoScrollEnabled?: boolean;
  selectedPromptName?: string | null;
  initialChatPrompt?: string | null;
}

// Session-related payloads
export interface LoadSessionSuccessPayload {
  messages: Message[];
  sessionId: string;
  prevId: string | null;
  nextId: string | null;
}

export interface SendMessageRequestPayload {
  prompt: string;
}

export interface EditMessageRequestPayload {
  index: number;
  newPrompt: string;
}

export interface RegenerateResponseRequestPayload {
  index: number;
}

export interface UpdateUserMessagePayload {
  index: number;
  message: Message;
}

export interface AppendChunkPayload {
  chunk: string;
}

export interface SubmitUserMessageSuccessPayload {
  model: string;
}

// Snippets-related payloads
export interface AddSnippetFailurePayload {
  name: string;
  error: AppError;
}

export interface UpdateSnippetSuccessPayload {
  oldName: string;
  snippet: import('./storage').Snippet;
}

export interface UpdateSnippetFailurePayload {
  id: string;
  error: AppError;
}

export interface RegenerateSnippetSuccessPayload {
  id: string;
  name: string;
  content: string;
}

export interface RegenerateSnippetFailurePayload {
  id: string;
  name: string;
  error: AppError;
}

export interface SetSnippetDirtyStatePayload {
  name: string;
  isDirty: boolean;
}

export interface UpdateSnippetContentPayload {
  id: string;
  content: string;
}

export interface AwaitableRegenerateRequestPayload {
  name: string;
}

export interface BatchRegenerateRequestPayload {
  snippets: import('./storage').Snippet[];
}

// Prompts-related payloads
export interface AddPromptFailurePayload {
  name: string;
  error: AppError;
}

export interface UpdatePromptRequestPayload {
  oldName: string;
  prompt: SystemPrompt;
}

export interface UpdatePromptSuccessPayload {
  oldName: string;
  prompt: SystemPrompt;
}

export interface UpdatePromptFailurePayload {
  name: string;
  error: AppError;
}

export interface DeletePromptFailurePayload {
  name: string;
  error: AppError;
}

// Models-related payloads (these are already fairly specific, but included for completeness)
export type FetchModelsSuccessPayload = DisplayModelInfo[];
