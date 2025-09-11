import { test as base } from '@playwright/test';

// Extend basic test by providing a page fixture that logs all console messages.
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => {
      const msgType = msg.type().toUpperCase();
      const msgText = msg.text();

      if (msgType === 'ERROR') {
        // Fail the test if a console error occurs
        throw new Error(`[BROWSER CONSOLE ERROR]: ${msgText}`);
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



