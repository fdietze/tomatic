import { test as base } from '@playwright/test';
import { format } from 'util';

interface LogEntry {
	type: 'TEST_SIDE_CONSOLE';
	timestamp: number;
	data: {
		level: 'log' | 'warn' | 'error' | 'info' | 'debug';
		message: string;
	};
}

export const testWithTestSideLogs = base.extend({
	page: async ({ page }, use, testInfo) => {
		const logs: LogEntry[] = [];
		const originalConsoleMethods = {
			log: console.log,
			warn: console.warn,
			error: console.error,
			info: console.info,
			debug: console.debug,
		};

		const patchConsole = (level: keyof typeof originalConsoleMethods) => {
			console[level] = (...args: unknown[]) => {
				logs.push({
					type: 'TEST_SIDE_CONSOLE',
					timestamp: Date.now(),
					data: {
						level,
						message: format(...args),
					},
				});
				// Call original method with correct `this` context
				originalConsoleMethods[level].apply(console, args);
			};
		};

		patchConsole('log');
		patchConsole('warn');
		patchConsole('error');
		patchConsole('info');
		patchConsole('debug');

		await use(page);

		// Restore original methods
		Object.assign(console, originalConsoleMethods);

		if (logs.length > 0) {
			await testInfo.attach('test-side-logs', {
				body: JSON.stringify(logs, null, 2),
				contentType: 'application/json',
			});
		}
	},
});