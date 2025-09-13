import { test as base } from '@playwright/test';

interface TestOptions {
  expectedConsoleErrors: (string | RegExp)[];
}

// Extend basic test by providing a page fixture that logs all console messages.
export const test = base.extend<TestOptions>({
  // Set a default value for the option
  expectedConsoleErrors: [],

  page: async ({ page, expectedConsoleErrors }, use, testInfo) => {
    const consoleMessages: string[] = [];
    const unhandledErrors: string[] = [];

    page.on('console', (msg) => {
      const msgType = msg.type().toUpperCase();
      const msgText = msg.text();

      // Filter out noisy Vite HMR messages for cleaner test logs
      if (
        msgText.startsWith('[vite]') ||
        msgText.includes('Download the React DevTools for a better development experience')
      ) {
        return;
      }
      // Always capture all messages
      consoleMessages.push(`[BROWSER CONSOLE|${msgType}]: ${msgText}`);

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
      const fullLog = consoleMessages.join('\n');
      const errorMessage = `[UNHANDLED BROWSER CONSOLE ERRORS]:\n - ${unhandledErrors.join(
        '\n - '
      )}\n\n[FULL BROWSER CONSOLE LOG]:\n${fullLog}`;
      throw new Error(errorMessage);
    }

    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(`[TEST FAILED]: ${testInfo.title}`);
      console.log('[BROWSER CONSOLE LOGS]:');
      consoleMessages.forEach((msg) => {
        console.log(msg);
      });
    }
  },
});
// We are extending the base test with custom fixtures.
// https://playwright.dev/docs/test-fixtures



