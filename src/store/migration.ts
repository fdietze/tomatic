import { saveSystemPrompt } from '@/services/db';
import type { AppState } from './types';
import { LocalStorageV0State, SystemPrompt } from '@/types/storage';

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

  console.debug('[Migration] Migrating old localStorage data to new format...');

  try {
    const oldState: LocalStorageV0State = {
      apiKey: oldApiKey || '',
      modelName: localStorage.getItem('MODEL_NAME') || 'google/gemini-2.5-pro',
      systemPrompts: JSON.parse(localStorage.getItem('system_prompts') || '[]') as unknown[],
      cachedModels: JSON.parse(localStorage.getItem('cached_models') || '[]') as unknown[],
      input: localStorage.getItem('input') || '',
      selectedPromptName: JSON.parse(localStorage.getItem('selected_prompt_name') || 'null') as unknown,
    };

    const newState = {
      state: oldState,
      version: 0, // This marks it as a v0 state needing migration by the persist middleware.
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

/**
 * Handles the migration from v0 to v1+. This is called by the `persist` middleware.
 * V0 state had system prompts in localStorage, while V1 moves them to IndexedDB.
 */
export const migrateStore = async (persistedState: unknown, version: number): Promise<AppState> => {
    if (version === 0) {
        const oldState = persistedState as LocalStorageV0State;
        if (oldState.systemPrompts.length > 0) {
            console.debug('[Migration] Migrating system prompts from localStorage to IndexedDB...');
            try {
                // We can't be sure of the exact type from old LS, so we cast to the current SystemPrompt type.
                // The saveSystemPrompt function will perform Zod validation.
                const promptsToMigrate = oldState.systemPrompts as SystemPrompt[];
                for (const prompt of promptsToMigrate) {
                    // This will overwrite existing prompts with the same name if any.
                    await saveSystemPrompt(prompt);
                }
                console.debug(`[Migration] Successfully migrated ${String(promptsToMigrate.length)} prompts.`);
                // We don't need to remove systemPrompts from oldState because
                // the `partialize` function will prevent it from being
                // re-persisted into localStorage on the next save.
            } catch (error) {
                console.error('[Migration] Failed to migrate system prompts:', error);
            }
        }
    }
    return persistedState as AppState;
};