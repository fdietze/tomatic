import { z } from 'zod';
import { createAppError } from '@/types/errors';

// --- Zod Schemas for Runtime Validation ---
export const messageCostSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
});

export const messageSchema = z.object({
  id: z.string(),
  prompt_name: z.string().nullable().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  raw_content: z.string().optional(),
  model_name: z.string().nullable().optional(),
  cost: messageCostSchema.nullable().optional(),
  error: z.string().nullable().optional(),
}).transform((data): import('@/types/chat').Message => ({
  ...data,
  error: data.error 
    ? createAppError.unknown(data.error) 
    : null,
}));

export const chatSessionSchema = z.object({
  session_id: z.string(),
  messages: z.array(messageSchema),
  name: z.string().nullable().optional(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  prompt_name: z.string().nullable().optional(), // Added from session-navigation.spec.ts
});

export const systemPromptSchema = z.object({
  name: z.string(),
  prompt: z.string(),
});

export const snippetSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  isGenerated: z.boolean(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  createdAt_ms: z.number(),
  updatedAt_ms: z.number(),
  generationError: z.string().nullable(),
  isDirty: z.boolean(),
}).transform((data): import('@/types/storage').Snippet => ({
  ...data,
  generationError: data.generationError 
    ? createAppError.unknown(data.generationError) 
    : null,
}));
