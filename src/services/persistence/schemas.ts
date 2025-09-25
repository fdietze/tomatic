import { z } from 'zod';

/**
 * Zod schemas for validating localStorage data to prevent runtime errors
 * from corrupted or outdated stored data.
 */

// Schema for the persisted settings state (partial because not all fields may be stored)
export const persistedSettingsStateSchema = z.object({
  apiKey: z.string().optional(),
  modelName: z.string().optional(), 
  autoScrollEnabled: z.boolean().optional(),
  selectedPromptName: z.string().nullable().optional(),
  initialChatPrompt: z.string().nullable().optional(),
  // Note: loading and saving states are not persisted as they are runtime-only
});

// Schema for the complete localStorage structure
export const localStorageSchema = z.object({
  state: persistedSettingsStateSchema,
  version: z.number(),
});

export type PersistedSettingsState = z.infer<typeof persistedSettingsStateSchema>;
export type LocalStorageData = z.infer<typeof localStorageSchema>;
