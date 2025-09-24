import { z } from 'zod';

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
});

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
});
