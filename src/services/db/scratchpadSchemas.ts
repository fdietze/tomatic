import { z } from 'zod';
import { createAppError } from '@/types/errors';
import { messageCostSchema } from './schemas';
import type { ScratchpadSession } from '@/types/scratchpad';

export const scratchpadInputSchema = z.object({
  id: z.string(),
  raw_content: z.string(),
  resolved_content: z.string(),
});

export const scratchpadResponseSchema = z
  .object({
    content: z.string(),
    model_name: z.string(),
    cost: messageCostSchema.nullable().optional(),
    error: z.string().nullable().optional(),
    is_stale: z.boolean(),
  })
  .transform((data) => ({
    ...data,
    // Convert stored error string back into the in-memory AppError shape
    error: data.error ? createAppError.unknown(data.error) : null,
  }));

export const scratchpadSessionSchema: z.ZodType<ScratchpadSession> = z.object({
  session_id: z.string(),
  prompt_name: z.string().nullable().optional(),
  inputs: z.array(scratchpadInputSchema),
  response: scratchpadResponseSchema.nullable(),
  name: z.string().nullable().optional(),
  created_at_ms: z.number(),
  updated_at_ms: z.number(),
  // req:scratchpad-include-last-response-persisted: default to false so v4 rows
  // load cleanly (lazy v4 -> v5 backfill via schema; no eager migration needed).
  include_last_response: z.boolean().default(false),
  // The cast below is intentional: Zod's transform pipeline produces a slightly
  // different inferred type, and we want the consumer-facing type to be the
  // domain type from scratchpad.ts.
}) as unknown as z.ZodType<ScratchpadSession>;
