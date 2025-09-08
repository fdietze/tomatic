import { test, expect } from '@playwright/test';

const OPENROUTER_API_KEY = 'TEST_API_KEY';

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    (key) => {
      window.localStorage.setItem(
        'tomatic-storage',
        JSON.stringify({
          state: {
            apiKey: key,
          },
          version: 0,
        }),
      );
    },
    [OPENROUTER_API_KEY],
  );

  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const streamData = [
      '{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      '{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      '{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}',
      '{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    ];
    const body = streamData.map(line => `data: ${line}\n\n`).join('') + 'data: [DONE]\n\n';
    await route.fulfill({
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
      body,
    });
  });

  await page.goto('http://localhost:5173/chat/new');
});

test('sends a message and sees the response', async ({ page }) => {
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('chat-submit').click();

  await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveText(/Hello/);
  await expect(page.locator('[data-testid="chat-message"][data-role="assistant"]')).toHaveText(/Hello!/);
});
