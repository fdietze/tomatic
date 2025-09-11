import { test as base } from '@playwright/test';

interface TestOptions {
  expectedConsoleErrors: (string | RegExp)[];
}

// Extend basic test by providing a page fixture that logs all console messages.
export const test = base.extend<TestOptions>({
  // Set a default value for the option
  expectedConsoleErrors: [[], { option: true }],

  page: async ({ page, expectedConsoleErrors }, use, testInfo) => {
    const consoleMessages: string[] = [];
    const unhandledErrors: string[] = [];

    page.on('console', (msg) => {
      const msgType = msg.type().toUpperCase();
      const msgText = msg.text();

      if (msgType === 'ERROR') {
        const isExpected = expectedConsoleErrors.some((pattern) => {
          if (typeof pattern === 'string') {
            return msgText.includes(pattern);
          }
          return pattern.test(msgText);
        });

        if (!isExpected) {
          unhandledErrors.push(msgText);
        }
      }

      // Filter out noisy Vite HMR messages for cleaner test logs
      if (
        msgText.startsWith('[vite]') ||
        msgText.includes('Download the React DevTools for a better development experience')
      ) {
        return;
      }
      consoleMessages.push(`[BROWSER CONSOLE|${msgType}]: ${msgText}`);
    });

    await use(page);

    if (unhandledErrors.length > 0) {
        throw new Error(`[UNHANDLED BROWSER CONSOLE ERRORS]:\n - ${unhandledErrors.join('\n - ')}`);
    }

    if (testInfo.status !== testInfo.expectedStatus) {
      console.debug(`[TEST FAILED]: ${testInfo.title}`);
      console.debug('[BROWSER CONSOLE LOGS]:');
      consoleMessages.forEach((msg) => {
        console.debug(msg);
      });
    }
  },
});
// We are extending the base test with custom fixtures.
// https://playwright.dev/docs/test-fixtures



