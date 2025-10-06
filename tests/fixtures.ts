import { test as base, mergeTests, type TestInfo } from '@playwright/test';
import { testWithLogging } from './logging-fixture';
import { testWithTestSideLogs } from './test-side-logging-fixture';
import { networkSecurityTest } from './network-security-fixture';
import { ROUTES } from '@/utils/routes';
import { 
  mockGlobalApis, 
  OPENROUTER_API_KEY, 
  seedLocalStorage, 
  seedIndexedDB, 
  waitForEvent 
} from './test-helpers';
import type { IndexedDBDataCurrent, LocalStorageV1State } from '../src/types/storage';

export interface ConsoleErrorOptions {
	expectedConsoleErrors: (string | RegExp)[];
}

export interface TestFixtures {
	dbSeed: Partial<IndexedDBDataCurrent>;
	localStorageOverrides?: Partial<LocalStorageV1State>;
}

export const testWithConsoleErrors = base.extend<ConsoleErrorOptions>({
	expectedConsoleErrors: [],

	page: async ({ page, expectedConsoleErrors }, use) => {
		const unhandledErrors: string[] = [];

        page.on('pageerror', (err) => {
            unhandledErrors.push(err.message);
        });
        
		page.on('console', (msg) => {
            const msgType = msg.type().toUpperCase();
            const msgText = msg.text();

			if (msgType === 'ERROR') {
				const isExpected =
					Array.isArray(expectedConsoleErrors) &&
					expectedConsoleErrors.some((pattern) => {
						if (typeof pattern === 'string') {
							return msgText.includes(pattern);
						}
						return pattern.test(msgText);
					});

				if (!isExpected) {
					unhandledErrors.push(msgText);
				}
			}
		});

		await use(page);

		if (unhandledErrors.length > 0) {
			throw new Error(`[UNHANDLED BROWSER CONSOLE ERRORS]:\n - ${unhandledErrors.join('\n - ')}`);
		}
	},
});

export const test = mergeTests(
	testWithConsoleErrors,
	testWithLogging,
	networkSecurityTest,
	testWithTestSideLogs
).extend({
	context: async ({ context }, use, _testInfo: TestInfo) => {
		await context.addInitScript(() => {
			window.__IS_TESTING__ = true;
			
			const events: { type: string; detail: unknown }[] = [];
			window.app_events = events;
			
			const originalDispatchEvent = window.dispatchEvent;
			window.dispatchEvent = function (this: Window, event: Event): boolean {
				if (event instanceof CustomEvent) {
					events.push({ type: event.type, detail: event.detail });
				}
				return originalDispatchEvent.apply(this, [event]) as boolean;
			};
		});
		await use(context);
	},
});

/**
 * Enhanced test fixture that handles complete initialization in the correct order:
 * - Sets up API mocks and localStorage (with optional overrides)
 * - Seeds IndexedDB with provided data (or empty state if none provided)
 * - Navigates to /chat/new
 * - Waits for app_initialized event
 * - Protects against improper use of page.goto after initialization
 * 
 * Usage: 
 * - Simple: `import { testWithAutoInit as test } from "./fixtures"`
 * - With data: `test.use({ dbSeed: { snippets: [...] } })`
 * - With localStorage: `test.use({ localStorageOverrides: { selectedPromptName: "Chef" } })`
 * - Combined: `test.use({ dbSeed: {...}, localStorageOverrides: {...} })`
 */
export const testWithAutoInit = test.extend<TestFixtures>({
	dbSeed: {},
	localStorageOverrides: undefined,
	
	page: async ({ page, context, dbSeed, localStorageOverrides }, use) => {
		let hasNavigatedInitially = false;
		
		// Set up global API mocks
		await mockGlobalApis(context);
		
		// Merge default localStorage settings with overrides
		const defaultLocalStorageState: LocalStorageV1State = {
			apiKey: OPENROUTER_API_KEY,
			modelName: "google/gemini-2.5-pro",
			autoScrollEnabled: false,
			cachedModels: [],
			input: "",
			selectedPromptName: null,
		};
		
		const finalLocalStorageState = {
			...defaultLocalStorageState,
			...localStorageOverrides
		};
		
		// Seed localStorage with merged settings
		await seedLocalStorage(context, {
			state: finalLocalStorageState,
			version: 1,
		});
		
		// Seed IndexedDB with provided data or empty state
		const seedData: Partial<IndexedDBDataCurrent> = {
			snippets: [],
			chat_sessions: [],
			system_prompts: [],
			...dbSeed
		};
		await seedIndexedDB(context, seedData);
		
		// Navigate to initial page and wait for initialization
		await page.goto(ROUTES.chat.new);
		hasNavigatedInitially = true;
		await waitForEvent(page, "app_initialized");
		
		// req:test-no-page-goto: Override page.goto to prevent accidental navigation after initialization
		const originalGoto = page.goto.bind(page);
		page.goto = async (url: string | URL, options?: Parameters<typeof originalGoto>[1]) => {
			if (hasNavigatedInitially) {
				const urlString = typeof url === 'string' ? url : url.toString();
				throw new Error(
					`❌ page.goto() called after initial navigation!\n\n` +
					`Attempted URL: ${urlString}\n\n` +
					`This resets the database state and breaks test isolation.\n` +
					`Use UI navigation instead:\n` +
					`  ✅ await chatPage.navigation.goToSettings()\n` +
					`  ✅ await settingsPage.navigation.goBackToChat()\n` +
					`  ❌ await page.goto(ROUTES.settings)`
				);
			}
			const urlString = typeof url === 'string' ? url : url.toString();
			return originalGoto(urlString, options);
		};
		
		await use(page);
	},
});

export { expect } from '@playwright/test';



