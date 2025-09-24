import { test as base, mergeTests, type TestInfo } from '@playwright/test';
import { testWithLogging } from './logging-fixture';
import { networkSecurityTest } from './network-security-fixture';

export interface ConsoleErrorOptions {
	expectedConsoleErrors: (string | RegExp)[];
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

export const test = mergeTests(testWithConsoleErrors, testWithLogging, networkSecurityTest).extend({
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


export { expect } from '@playwright/test';



