import { test as base, mergeTests } from '@playwright/test';
import { testWithLogging } from './logging-fixture';
import { networkSecurityTest } from './network-security-fixture';

export interface ConsoleErrorOptions {
	expectedConsoleErrors: (string | RegExp)[];
}

export const testWithConsoleErrors = base.extend<ConsoleErrorOptions>({
	expectedConsoleErrors: [],

	page: async ({ page, expectedConsoleErrors }, use) => {
		const unhandledErrors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type().toUpperCase() === 'ERROR') {
				const msgText = msg.text();
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
	context: async ({ context }, use) => {
		await context.addInitScript(() => {
			window.__IS_TESTING__ = true;
		});
		await use(context);
	},
});


export { expect } from '@playwright/test';



