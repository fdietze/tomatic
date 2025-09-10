import { test, expect, createStreamResponse } from './fixtures';
import type { Buffer } from 'buffer';

interface ChatRequestBody {
  model: string;
}

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5173/chat/new');
});

test('sends a message and sees the response', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Hello!');
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  await page.getByTestId('chat-input').fill('Hello');
  const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-submit').click();
  await responsePromise;

  await expect(
    page.locator('[data-testid="chat-message-0"][data-role="user"] .chat-message-content')
  ).toHaveText(/Hello/);
  await expect(
    page.locator('[data-testid="chat-message-1"][data-role="assistant"] .chat-message-content')
  ).toHaveText(/Hello!/);

  // Send a second message
  await page.getByTestId('chat-input').fill('Second message');
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-submit').click();
  await responsePromise2;

  await expect(
    page.locator('[data-testid="chat-message-2"][data-role="user"] .chat-message-content')
  ).toHaveText(/Second message/);
  await expect(
    page.locator('[data-testid="chat-message-3"][data-role="assistant"] .chat-message-content')
  ).toHaveText(/Hello!/);
});

test('can select a model and get a model-specific response', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const requestBody = (await route.request().postDataJSON()) as ChatRequestBody;
    const model = requestBody.model;

    let responseBody: Buffer;
    if (model === 'mock-model/mock-model') {
      responseBody = createStreamResponse(model, 'Response from Mock Model');
    } else {
      responseBody = createStreamResponse('openai/gpt-4o', 'Hello!');
    }
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  // The first message will use the default model 'openai/gpt-4o'
  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('chat-submit').click();
  await responsePromise1;
  await expect(
    page.locator('[data-testid="chat-message-1"][data-role="assistant"] .chat-message-content')
  ).toHaveText(/Hello!/);

  // Select the mock model
  await page.locator('input[placeholder^="Select or type model ID"]').fill('mock');
  await page.locator('.combobox-item', { hasText: 'Mock Model' }).click();
  await expect(page.locator('input[placeholder^="Select or type model ID"]')).toHaveValue(
    'mock-model/mock-model'
  );

  // Send a message with the new model
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-input').fill('Another message');
  await page.getByTestId('chat-submit').click();
  await responsePromise2;

  // Check for the mock model's specific response
  await expect(
    page.locator('[data-testid="chat-message-3"][data-role="assistant"] .chat-message-content')
  ).toHaveText(/Response from Mock Model/);

  // Also verify the model name is displayed in the message details
  await expect(
    page.locator('[data-testid="chat-message-3"][data-role="assistant"] .chat-message-role')
  ).toHaveText('assistant (mock-model/mock-model)');
});

test('can regenerate an assistant response', async ({ page }) => {
  // 1. Send an initial message and get a response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Hello!');
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });
  await page.getByTestId('chat-input').fill('Initial message');
  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-submit').click();
  await responsePromise1;

  // Verify initial messages
  await expect(page.locator('[data-testid="chat-message-0"] .chat-message-content')).toHaveText(/Initial message/);
  await expect(page.locator('[data-testid="chat-message-1"] .chat-message-content')).toHaveText(/Hello!/);
  await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(2);

  // 2. Mock the next response to be different.
  await page.unroute('https://openrouter.ai/api/v1/chat/completions');
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'This is a regenerated response.');
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  // 3. Click the regenerate button on the assistant's message
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.locator('[data-testid="chat-message-1"] button:has-text("regenerate")').click();
  await responsePromise2;

  // 4. Assertions
  // The user message should still be there
  await expect(page.locator('[data-testid="chat-message-0"] .chat-message-content')).toHaveText(/Initial message/);

  // The new assistant message should have the regenerated content, replacing the old one.
  await expect(page.locator('[data-testid="chat-message-1"] .chat-message-content')).toHaveText(
    /This is a regenerated response./
  );

  // The total number of messages should still be 2.
  await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(2);
});

test('sends first message in a new session from UI', async ({ page }) => {
  // 1. Start on a different page to ensure we're testing the 'new chat' flow
  await page.goto('http://localhost:5173/settings');

  // 2. Navigate to a new chat page by clicking the chat tab button
  await page.getByRole('button', { name: 'Chat' }).click();
  await page.waitForURL('**/chat/new');

  // 3. Mock the response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'First message response');
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  // 4. Send a message
  await page.getByTestId('chat-input').fill('First message in new session');
  const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-submit').click();
  await responsePromise;

  // 5. Assertions
  await expect(
    page.locator('[data-testid="chat-message-0"][data-role="user"] .chat-message-content')
  ).toHaveText(/First message in new session/);
  await expect(
    page.locator('[data-testid="chat-message-1"][data-role="assistant"] .chat-message-content')
  ).toHaveText(/First message response/);
});

test('shows system prompt immediately in a new chat', async ({ page }) => {
  // 1. Seed localStorage with a selected system prompt
  await page.addInitScript(() => {
    const persistedState = {
      state: {
        systemPrompts: [{ name: 'TestPrompt', prompt: 'You are a test bot.' }],
        apiKey: 'TEST_API_KEY',
        selectedPromptName: 'TestPrompt',
      },
      version: 0, // Set to 0 to trigger migration
    };
    window.localStorage.setItem('tomatic-storage', JSON.stringify(persistedState));
  });

  // 2. Go to an arbitrary page that has the chat header, like an existing chat
  await page.goto('http://localhost:5173/chat/some-session-id');

  // 3. Click the "New Chat" button to start a fresh session
  await page.getByRole('button', { name: 'New Chat' }).click();
  await page.waitForURL('**/chat/new');

  // 4. Assert that the system message is immediately visible
  await expect(page.locator('[data-testid="chat-message-0"][data-role="system"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="chat-message-0"] .chat-message-content')
  ).toHaveText(/You are a test bot/);
});

test('can collapse and expand messages', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tomatic-storage', JSON.stringify({
      state: { apiKey: 'TEST_API_KEY' },
      version: 1,
    }));
  });

  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Assistant response');
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  await page.route('https://openrouter.ai/api/v1/models', async (route) => {
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto('http://localhost:5173/chat/new');
  await page.waitForURL('**/chat/new');

  await page.getByTestId('chat-input').fill('User message');
  const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await page.getByTestId('chat-submit').click();
  await responsePromise;

  const userMessage = page.locator('[data-testid="chat-message-0"][data-role="user"]');
  const assistantMessage = page.locator('[data-testid="chat-message-1"][data-role="assistant"]');

  await expect(userMessage).toBeVisible();
  await expect(assistantMessage).toBeVisible();

  // Test collapsing and expanding the user message
  await expect(userMessage).not.toHaveClass(/collapsed/);
  await userMessage.locator('button:has-text("[-]")').click();
  await expect(userMessage).toHaveClass(/collapsed/);
  await userMessage.locator('button:has-text("[+]")').click();
  await expect(userMessage).not.toHaveClass(/collapsed/);

  // Test collapsing and expanding the assistant message
  await expect(assistantMessage).not.toHaveClass(/collapsed/);
  await assistantMessage.locator('button:has-text("[-]")').click();
  await expect(assistantMessage).toHaveClass(/collapsed/);
  await assistantMessage.locator('button:has-text("[+]")').click();
  await expect(assistantMessage).not.toHaveClass(/collapsed/);
});
