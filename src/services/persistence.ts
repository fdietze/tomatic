import { openDB, type DBSchema } from 'idb';
import type { ChatSession, Message } from '@/types/chat';
import type { Snippet, SystemPrompt } from '@/types/storage';

// For DB version < 2
type V1Message = Omit<Message, 'id' | 'prompt_name'> & { id?: string; prompt_name?: string | null };

// For DB version < 3
type V2Snippet = Omit<Snippet, 'createdAt_ms' | 'updatedAt_ms' | 'generationError' | 'isDirty'>;

// --- IndexedDB Constants ---
export const DB_NAME = 'tomatic_chat_db';
export const DB_VERSION = 3;
export const SESSIONS_STORE_NAME = 'chat_sessions';
export const SYSTEM_PROMPTS_STORE_NAME = 'system_prompts';
export const SNIPPETS_STORE_NAME = 'snippets';
export const SESSION_ID_KEY_PATH = 'session_id';
export const NAME_KEY_PATH = 'name';
export const UPDATED_AT_INDEX = 'updated_at_ms';

// --- IDB Schema Definition ---
interface TomaticDB extends DBSchema {
	[SESSIONS_STORE_NAME]: {
		key: string;
		value: ChatSession;
		indexes: {
			[UPDATED_AT_INDEX]: number;
		};
	};
	[SYSTEM_PROMPTS_STORE_NAME]: {
		key: string;
		value: SystemPrompt;
	};
	[SNIPPETS_STORE_NAME]: {
		key: string;
		value: Snippet;
	};
}

// --- Database Interaction Functions ---

export const dbPromise = openDB<TomaticDB>(DB_NAME, DB_VERSION, {
	upgrade(db, oldVersion, _newVersion, tx) {
		if (oldVersion < 2) {
			console.log('[DB] Upgrading database from version 1 to 2...');
			// Create sessions store
			if (!db.objectStoreNames.contains(SESSIONS_STORE_NAME)) {
				const store = db.createObjectStore(SESSIONS_STORE_NAME, { keyPath: SESSION_ID_KEY_PATH });
				store.createIndex(UPDATED_AT_INDEX, 'updated_at_ms');
			}

			// Create system prompts store
			if (!db.objectStoreNames.contains(SYSTEM_PROMPTS_STORE_NAME)) {
				db.createObjectStore(SYSTEM_PROMPTS_STORE_NAME, { keyPath: NAME_KEY_PATH });
			}

			// Migrate data
			void tx
				.objectStore(SESSIONS_STORE_NAME)
				.openCursor()
				.then(function migrate(cursor) {
					if (!cursor) {
						console.log('[DB] Migration complete.');
						return;
					}

					const oldSession = cursor.value;

					// V2 introduces optional `name` on sessions and required `id` and optional `prompt_name` on messages
					const newSession: ChatSession = {
						...oldSession,
						name: oldSession.name || null,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						messages: (oldSession.messages as any[]).map((m: V1Message) => {
							const newMessage: Message = {
								...m,
								id: m.id || crypto.randomUUID(),
								prompt_name: m.prompt_name || null,
							};
							return newMessage;
						}),
					};

					void cursor.update(newSession);
					void cursor.continue().then(migrate);
				});
		}
		if (oldVersion < 3) {
			console.log('[DB] Upgrading database from version 2 to 3...');
			if (!db.objectStoreNames.contains(SNIPPETS_STORE_NAME)) {
				db.createObjectStore(SNIPPETS_STORE_NAME, { keyPath: NAME_KEY_PATH });
			}

			// Migrate existing snippets to include new fields for regeneration tracking
			void tx
				.objectStore(SNIPPETS_STORE_NAME)
				.openCursor()
				.then(function migrateSnippets(cursor) {
					if (!cursor) return;

					const oldSnippet = cursor.value as V2Snippet;
					const now = Date.now();

					const newSnippet: Snippet = {
						...oldSnippet,
						createdAt_ms: now,
						updatedAt_ms: now,
						generationError: null,
						isDirty: false,
					};

					void cursor.update(newSnippet);
					void cursor.continue().then(migrateSnippets);
				});
		}
	},
});
