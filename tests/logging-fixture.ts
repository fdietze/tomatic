/**
 * # Custom Playwright Fixture for Browser Log Collection
 *
 * This file contains a Playwright test fixture that forms the first half of a custom
 * logging system. Its sole responsibility is to capture all browser-side events
 * during a test run.
 *
 * ## How it Works:
 * 1.  **Event Listeners**: It attaches listeners to the `page` object for `console`
 *     messages, network `request`s, and network `response`s.
 *
 * 2.  **Log Aggregation**: Each event is timestamped and stored in an in-memory
 *     array. No filtering or processing is done here; it's a raw data capture.
 *
 * 3.  **Data Attachment**: After the test completes (regardless of status), the
 *     entire array of captured logs is serialized into a JSON string and attached
 *     to the test result via `testInfo.attach('browser-logs', ...)`.
 *
 * ## Why this Architecture?
 * This fixture is designed to be a self-contained, single-responsibility component.
 * It cleanly separates the act of *collecting* logs from *reporting* them. By
 * using `testInfo.attach()`, it provides the captured data to the reporter via
 * Playwright's canonical, robust data-passing mechanism, without needing to know
 * which reporter will consume it or how.
 *
 * This fixture is composed with the console error fixture in `tests/fixtures.ts`
 * to create the final `test` object used by the test suite.
 */

import { test as base } from '@playwright/test';

interface LogEntry {
	type: 'BROWSER_CONSOLE' | 'NETWORK_REQUEST' | 'NETWORK_RESPONSE';
	timestamp: number;
	data: any;
}

export const testWithLogging = base.extend({
	page: async ({ page }, use, testInfo) => {
		const logs: LogEntry[] = [];
		const baseURL = testInfo.project.use.baseURL;

		page.on('request', (req) => {
			try {
				if ((baseURL && req.url().startsWith(baseURL)) || req.url().startsWith('data:')) {
					return;
				}
				const postData = req.postData();
				const postDataLog = postData ? ` ${postData}` : '';
				logs.push({
					type: 'NETWORK_REQUEST',
					timestamp: Date.now(),
					data: {
						method: req.method(),
						url: req.url(),
						postDataLog,
					},
				});
			} catch (e) {
				logs.push({
					type: 'NETWORK_REQUEST',
					timestamp: Date.now(),
					data: {
						method: req.method(),
						url: req.url(),
						postDataLog: ' (post data unavailable)',
					},
				});
			}
		});

		page.on('response', async (res) => {
			try {
				if ((baseURL && res.url().startsWith(baseURL)) || res.url().startsWith('data:')) {
					return;
				}
				const status = res.status();
				const statusText = status > 0 ? ` ${res.statusText()}` : '';
				logs.push({
					type: 'NETWORK_RESPONSE',
					timestamp: Date.now(),
					data: {
						status: `${status}${statusText}`,
						url: res.url(),
					},
				});
			} catch (e) {
				logs.push({
					type: 'NETWORK_RESPONSE',
					timestamp: Date.now(),
					data: {
						status: '(response unavailable)',
						url: res.url(),
					},
				});
			}
		});

		page.on('console', (msg) => {
			const msgType = msg.type().toUpperCase();
			const msgText = msg.text();

			if (
				msgText.startsWith('[vite]') ||
				msgText.includes('Download the React DevTools for a better development experience')
			) {
				return;
			}

			logs.push({
				type: 'BROWSER_CONSOLE',
				timestamp: Date.now(),
				data: {
					type: msgType,
					text: msgText,
				},
			});
		});

		await use(page);

		testInfo.attach('browser-logs', {
			body: JSON.stringify(logs, null, 2),
			contentType: 'application/json',
		});
	},
});
