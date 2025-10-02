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
const path = require('path');

/** @implements {import('@playwright/test/reporter').Reporter} */
class PwActionsReporter {
  constructor() {
    this.logs = new Map();
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.startTime = 0;
    this.cwd = process.cwd();
  }

  onBegin(config, suite) {
    this.startTime = Date.now();
    console.log(`Running ${suite.allTests().length} tests`);
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
    if (result.status === 'passed') {
      this.passed++;
      console.log(`✓ ${test.title}`);
    } else if (result.status === 'skipped') {
      this.skipped++;
      console.log(`- ${test.title}`);
    } else {
      this.failed++;
      const pwLogs = this.logs.get(test.id) || [];
      let browserLogs = [];
      let testSideLogs = [];

      const browserLogsAttachment = result.attachments.find((a) => a.name === 'browser-logs');
      if (browserLogsAttachment && browserLogsAttachment.body) {
        try {
          browserLogs = JSON.parse(browserLogsAttachment.body.toString());
        } catch (e) {
          console.log(`[PwActionsReporter] Failed to parse browser logs attachment: ${e}`);
        }
      }

      const testSideLogsAttachment = result.attachments.find((a) => a.name === 'test-side-logs');
      if (testSideLogsAttachment && testSideLogsAttachment.body) {
        try {
          testSideLogs = JSON.parse(testSideLogsAttachment.body.toString());
        } catch (e) {
          console.log(`[PwActionsReporter] Failed to parse test-side logs attachment: ${e}`);
        }
      }

      const allLogs = [...pwLogs, ...browserLogs, ...testSideLogs].sort(
        (a, b) => a.timestamp - b.timestamp
      );

      const ANSI_RED = '\x1b[31m';
      const ANSI_YELLOW = '\x1b[33m';
      const ANSI_RESET = '\x1b[0m';

      const relativeLocation = path.relative(this.cwd, test.location.file);

      console.log(`\n\n${ANSI_RED}✗ ${test.title}${ANSI_RESET}`);
      console.log(`${ANSI_YELLOW}Location: ${relativeLocation}:${test.location.line}:${test.location.column}${ANSI_RESET}`);

      console.log(`\n${ANSI_YELLOW}### Interleaved logs:${ANSI_RESET}`);
      this.printLogs(allLogs);

      // Print error details
      if (result.errors && result.errors.length > 0) {
        console.log(`\n${ANSI_RED}Error Details:${ANSI_RESET}`);
        // Show all errors (the last one usually has the most detail)
        result.errors.forEach((error, index) => {
          if (error.stack) {
            console.log(error.stack);
            if (index < result.errors.length - 1) {
              console.log(''); // separator between errors
            }
          }
        });
      }
    }
    this.logs.delete(test.id);
  }

  onEnd(_result) {
    const duration = (Date.now() - this.startTime) / 1000;
    console.log(`\n${this.passed} passed, ${this.failed} failed, ${this.skipped} skipped in ${duration}s`);
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
        case 'BROWSER_CONSOLE': {
          let locationStr = '';
          if (log.data.location) {
            const loc = log.data.location;
            // Extract filename from URL if it's a full URL
            let fileDisplay = loc.url;
            if (loc.url) {
              // Remove base URL and query params
              fileDisplay = loc.url.split('?')[0];
              // Get just the filename for brevity
              const parts = fileDisplay.split('/');
              fileDisplay = parts[parts.length - 1] || fileDisplay;
            }
            if (fileDisplay && loc.line !== undefined) {
              locationStr = ` [${fileDisplay}:${loc.line}]`;
            }
          }
          console.log(`${log.data.type}: ${log.data.text}${locationStr}`);
          break;
        }
        case 'TEST_SIDE_CONSOLE':
          console.log(`TEST ${log.data.level.toUpperCase()}: ${log.data.message}`);
          break;
      }
    });
  }
}
module.exports = PwActionsReporter;
