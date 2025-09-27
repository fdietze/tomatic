// req:migration-consolidation: Unified migration system for all storage layers
import { LocalStorageV1State, LocalStorageV2State, LocalStoragePersistedState } from '@/types/storage';
import type { Snippet } from '@/types/storage';

// --- Migration Version Constants ---
export const CURRENT_LOCALSTORAGE_VERSION = 2; // Migrating from deployed V1 to new V2
export const CURRENT_INDEXEDDB_VERSION = 3;    // Migrating from deployed V2 to new V3

// --- localStorage Migration Types ---

type V2Snippet = Omit<
  Snippet,
  "id" | "createdAt_ms" | "updatedAt_ms" | "generationError" | "isDirty"
>;

// --- localStorage Migrations ---

/**
 * Migrates localStorage from V1 (deployed) to V2 (current) format
 * V1 is the currently deployed version with cachedModels, input, etc.
 * V2 adds initialChatPrompt field and removes input/cachedModels from persistence
 */
function migrateLocalStorageV1ToV2(v1State: LocalStorageV1State): LocalStorageV2State {
  return {
    apiKey: v1State.apiKey || '',
    modelName: v1State.modelName || '',
    selectedPromptName: typeof v1State.selectedPromptName === 'string' ? v1State.selectedPromptName : null,
    autoScrollEnabled: v1State.autoScrollEnabled ?? true,
    initialChatPrompt: null, // New field in V2
    // Note: cachedModels and input are no longer persisted in V2
  };
}

/**
 * Migrates localStorage data to the current version
 * @param data - The raw localStorage data
 * @returns Migrated data in current format
 */
export function migrateLocalStorage(data: LocalStoragePersistedState<unknown>): LocalStoragePersistedState<LocalStorageV2State> {
  let currentData = data;
  
  // Migrate from V1 (deployed) to V2 (current)
  if (currentData.version === 1) {
    const v1State = currentData.state as LocalStorageV1State;
    const v2State = migrateLocalStorageV1ToV2(v1State);
    currentData = {
      state: v2State,
      version: 2,
    };
  }
  
  // Future localStorage migrations would go here
  // if (currentData.version === 2) { ... }
  
  return currentData as LocalStoragePersistedState<LocalStorageV2State>;
}

// --- IndexedDB Migration Utilities ---

/**
 * Migrates V2 (deployed) snippets to V3 (current) format by adding new required fields
 * V2 snippets don't exist in the deployed version, but this handles the case where
 * pre-release versions had snippets keyed by name instead of id
 */
export function migrateV2SnippetsToV3(v2Snippets: V2Snippet[]): Snippet[] {
  const now = Date.now();
  return v2Snippets.map((oldSnippet) => {
    const newSnippet: Snippet = {
      id: crypto.randomUUID(),
      ...oldSnippet,
      createdAt_ms: now,
      updatedAt_ms: now,
      generationError: null,
      isDirty: false,
    };
    return newSnippet;
  });
}

// --- Migration Registry ---

/**
 * Registry of all migrations across storage layers
 * This serves as documentation and validation
 */
export const MIGRATION_REGISTRY = {
  localStorage: {
    current: CURRENT_LOCALSTORAGE_VERSION,
    migrations: [
      {
        from: 1,
        to: 2,
        description: 'Remove cachedModels and input from persistence, add initialChatPrompt field',
        migrationFn: migrateLocalStorageV1ToV2,
      },
      // Future localStorage migrations go here
    ],
  },
  indexedDB: {
    current: CURRENT_INDEXEDDB_VERSION,
    migrations: [
      {
        from: 2,
        to: 3,
        description: 'Create snippets store with id-based keys and new schema fields',
        // IndexedDB migrations are handled in the upgrade callback in persistence.ts
      },
      // Future IndexedDB migrations go here
    ],
  },
} as const;

/**
 * Validates that all migration versions are properly defined
 */
export function validateMigrationRegistry(): void {
  const { localStorage, indexedDB } = MIGRATION_REGISTRY;
  
  // Validate localStorage migrations
  const localStorageMigrations = localStorage.migrations;
  if (localStorageMigrations.length > 0) {
    const lastLocalStorageMigration = localStorageMigrations[localStorageMigrations.length - 1];
    if (lastLocalStorageMigration && lastLocalStorageMigration.to !== localStorage.current) {
      throw new Error(`localStorage migration chain incomplete: last migration goes to ${String(lastLocalStorageMigration.to)}, but current version is ${String(localStorage.current)}`);
    }
  }
  
  // Validate IndexedDB migrations
  const indexedDBMigrations = indexedDB.migrations;
  if (indexedDBMigrations.length > 0) {
    const lastIndexedDBMigration = indexedDBMigrations[indexedDBMigrations.length - 1];
    if (lastIndexedDBMigration && lastIndexedDBMigration.to !== indexedDB.current) {
      throw new Error(`IndexedDB migration chain incomplete: last migration goes to ${String(lastIndexedDBMigration.to)}, but current version is ${String(indexedDB.current)}`);
    }
  }
}

// Validate on module load
validateMigrationRegistry();
