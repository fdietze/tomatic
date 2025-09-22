import { test as base } from '@playwright/test';

// Define an allowed list of hosts that tests can connect to.
// All other hosts will be blocked.
const ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
];

export const networkSecurityTest = base.extend({
  context: async ({ context }, use) => {
    await context.route('**/*', (route, request) => {
      const url = new URL(request.url());
      if (ALLOWED_HOSTS.includes(url.hostname)) {
        return route.continue();
      }

      // Any other request is considered external.
      // Our test-specific mocks for openrouter.ai should have already handled API calls.
      // If a request reaches this point, it means it's an unmocked external call,
      // which we should block.
      return route.abort('blockedbytest');
    });
    await use(context);
  },
});
