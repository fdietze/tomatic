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
        const formattedMessage = format(...args);
        logs.push({
          type: 'TEST_SIDE_CONSOLE',
          timestamp: Date.now(),
          data: {
            level,
            message: formattedMessage,
          },
        });
        // Buffer the output - don't call original method yet
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

    // Don't flush to stdout - let the reporter handle display
    // The logs will appear properly interleaved by timestamp in the reporter output

    // Always attach logs to test result for reporter
    if (logs.length > 0) {
      await testInfo.attach('test-side-logs', {
        body: JSON.stringify(logs, null, 2),
        contentType: 'application/json',
      });
    }
  },
});
