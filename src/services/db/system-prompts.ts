import { z } from 'zod';
import type { SystemPrompt } from '@/types/storage';
import { dbPromise, SYSTEM_PROMPTS_STORE_NAME } from '../persistence';
import { systemPromptSchema } from './schemas';
export async function saveSystemPrompt(prompt: SystemPrompt): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SYSTEM_PROMPTS_STORE_NAME, 'readwrite');
    await tx.store.put(prompt);
    await tx.done;
  } catch (error) {
    console.error('[DB] Save: Failed to save system prompt:', error);
    throw new Error('Failed to save system prompt.');
  }
}

export async function loadAllSystemPrompts(): Promise<SystemPrompt[]> {
  const db = await dbPromise;
  try {
    const prompts = await db.getAll(SYSTEM_PROMPTS_STORE_NAME);
    // Validate each prompt
    const validation = z.array(systemPromptSchema).safeParse(prompts);
    if (validation.success) {
      return validation.data;
    } else {
      console.error('[DB] Load: Zod validation failed for system prompts:', validation.error);
      return [];
    }
  } catch (error) {
    console.error('[DB] Load: Failed to load system prompts:', error);
    throw new Error('Failed to load system prompts.');
  }
}

export async function deleteSystemPrompt(promptName: string): Promise<void> {
  const db = await dbPromise;
  try {
    const tx = db.transaction(SYSTEM_PROMPTS_STORE_NAME, 'readwrite');
    await tx.store.delete(promptName);
    await tx.done;
  } catch (error) {
    console.error(`[DB] Delete: Failed to delete system prompt '${promptName}':`, error);
    throw new Error('Failed to delete system prompt.');
  }
}