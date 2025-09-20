// @ts-check

/**
 * # Custom Playwright Reporter for Interleaved Logging
 *
 * This reporter is the second half of a custom logging system designed to provide a
 * clear, chronological, and combined log for failed tests.
 *
 * ## How it Works:
 * 1.  **Capture Playwright Actions**: It hooks into `onStepBegin` and `onStepEnd` to
 *     capture the execution of Playwright's own API calls (e.g., `page.click()`, `expect()`).
 *     These are stored in memory with timestamps.
 *
 * 2.  **Consume Browser Logs**: For a failed test, this reporter looks for an attachment
 *     on the test result named `browser-logs`. This attachment is a JSON string
 *     provided by the custom fixture in `tests/logging-fixture.ts`, containing all
 *     console messages and network requests from the browser context.
 *
 * 3.  **Merge and Print**: It merges the Playwright action logs with the browser logs,
 *     sorts them by timestamp, and prints the final interleaved output to the console.
 *
 * ## Why this Architecture?
 * This approach decouples log *collection* (done by the fixture within the test
 * process) from log *reporting* (done by this reporter in the main process).
 * Using `testInfo.attach()` is the standard, robust Playwright mechanism for
 * passing data from a test to a reporter, avoiding brittle filesystem-based
 * communication. The result is a comprehensive debug log that helps diagnose
 * failures quickly.
 */

// const fs = require('fs').promises;
// const path = require('path');

/** @implements {import('@playwright/test/reporter').Reporter} */
class PwActionsReporter {
	constructor() {
		this.logs = new Map();
	}

	onTestBegin(test) {
		this.logs.set(test.id, []);
	}

	onStepBegin(test, result, step) {
		if (step.category === 'pw:api') {
			const testLogs = this.logs.get(test.id);
			if (testLogs) {
				testLogs.push({
					type: 'PW_ACTION_START',
					timestamp: Date.now(),
					data: {
						title: step.titlePath().join(' > '),
						location: `${step.location?.file}:${step.location?.line}`,
					},
				});
			}
		}
	}

	onStepEnd(test, result, step) {
		if (step.category === 'pw:api') {
			const testLogs = this.logs.get(test.id);
			if (testLogs) {
				testLogs.push({
					type: 'PW_ACTION_END',
					timestamp: Date.now(),
					data: {
						title: step.titlePath().join(' > '),
						duration: step.duration,
						status: step.error ? 'FAIL' : 'OK',
						error: step.error ? step.error.message : null,
					},
				});
			}
		}
	}

	async onTestEnd(test, result) {
		if (result.status !== 'passed' && result.status !== 'skipped') {
			const pwLogs = this.logs.get(test.id) || [];
			let browserLogs = [];

			const browserLogsAttachment = result.attachments.find((a) => a.name === 'browser-logs');
			if (browserLogsAttachment && browserLogsAttachment.body) {
				try {
					browserLogs = JSON.parse(browserLogsAttachment.body.toString());
				} catch (e) {
					console.log(`[PwActionsReporter] Failed to parse browser logs attachment: ${e}`);
				}
			}

			const allLogs = [...pwLogs, ...browserLogs].sort((a, b) => a.timestamp - b.timestamp);

			console.log(`\n\n### logs for "${test.title}":`);
			this.printLogs(allLogs);
		}
		this.logs.delete(test.id);
	}

	printLogs(logs) {
		logs.forEach((log) => {
			const ANSI_BLUE = '\x1b[34m';
			const ANSI_GREEN = '\x1b[32m';
			const ANSI_RESET = '\x1b[0m';
			
			switch (log.type) {
				case 'PW_ACTION_START':
					console.log(`${ANSI_BLUE}PW START: ${log.data.title}${ANSI_RESET}`);
					break;
				case 'PW_ACTION_END': {
					const status = log.data.error ? `FAIL: ${log.data.error}` : 'OK';
					console.log(`${ANSI_BLUE}PW END:   ${log.data.title} (${log.data.duration}ms) ${status}${ANSI_RESET}`);
					break;
				}
				case 'NETWORK_REQUEST':
					console.log(
						`${ANSI_GREEN}NET: ${log.data.method} ${log.data.url}${log.data.postDataLog}${ANSI_RESET}`
					);
					break;
				case 'NETWORK_RESPONSE':
					console.log(`${ANSI_BLUE}NET: ${log.data.status} ${log.data.url}${ANSI_RESET}`);
					break;
				case 'BROWSER_CONSOLE':
					console.log(`${log.data.type}: ${log.data.text}`);
					break;
			}
		});
	}
}
module.exports = PwActionsReporter;
