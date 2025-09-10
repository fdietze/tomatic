import { test, expect, createStreamResponse, mockApis } from './fixtures';
import type { Buffer } from 'buffer';

interface ChatRequestBody {
  model: string;
}

test.beforeEach(async ({ page }) => {
  await mockApis(page);
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
  await page.goto('http://localhost:5173/settings');

  // 3. Click the "New Chat" button to start a fresh session
  await page.getByRole('button', { name: 'Chat' }).click();
  await page.waitForURL('**/chat/new');

  // 4. Assert that the system message is immediately visible
  await expect(page.locator('[data-testid="chat-message-0"][data-role="system"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="chat-message-0"] .chat-message-content')
  ).toHaveText(/You are a test bot/);
});

test('can edit a user message and resubmit', async ({ page }) => {
  // 1. Send an initial message and get a response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Initial response');
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
  await expect(
    page.locator('[data-testid="chat-message-0"] .chat-message-content')
  ).toHaveText(/Initial message/);
  await expect(
    page.locator('[data-testid="chat-message-1"] .chat-message-content')
  ).toHaveText(/Initial response/);
  await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(2);

  // 2. Mock the next response for the edited message.
  await page.unroute('https://openrouter.ai/api/v1/chat/completions');
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse(
      'openai/gpt-4o',
      'Response to edited message.'
    );
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  // 3. Click the edit button on the user's message, edit it, and save.
  const userMessage = page.locator('[data-testid="chat-message-0"][data-role="user"]');
  await userMessage.getByRole('button', { name: 'edit' }).click();

  const editTextArea = userMessage.locator('textarea');
  await editTextArea.fill('Edited message');

  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await userMessage.getByRole('button', { name: 'Re-submit' }).click();
  await responsePromise2;

  // 4. Assertions
  // The user message should be updated.
  await expect(
    page.locator('[data-testid="chat-message-0"] .chat-message-content')
  ).toHaveText(/Edited message/);

  // The new assistant message should have the new content, replacing the old one.
  await expect(
    page.locator('[data-testid="chat-message-1"] .chat-message-content')
  ).toHaveText(/Response to edited message./);

  // The total number of messages should still be 2.
  await expect(page.locator('[data-testid^="chat-message-"]')).toHaveCount(2);
});

test('can edit a user message and discard changes', async ({ page }) => {
  // 1. Send an initial message and get a response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Initial response');
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
  await expect(
    page.locator('[data-testid="chat-message-0"] .chat-message-content')
  ).toHaveText(/Initial message/);
  await expect(
    page.locator('[data-testid="chat-message-1"] .chat-message-content')
  ).toHaveText(/Initial response/);

  // 2. Click the edit button, change the text, then cancel.
  const userMessage = page.locator('[data-testid="chat-message-0"][data-role="user"]');
  await userMessage.getByRole('button', { name: 'edit' }).click();

  const editTextArea = userMessage.locator('textarea');
  await editTextArea.fill('This change should be discarded');

  await userMessage.getByRole('button', { name: 'Discard' }).click();

  // 3. Assertions
  // The user message should NOT be updated.
  await expect(
    page.locator('[data-testid="chat-message-0"] .chat-message-content')
  ).toHaveText(/Initial message/);
  // The textarea should be gone.
  await expect(userMessage.locator('textarea')).not.toBeVisible();
  // The assistant message should be unchanged.
  await expect(
    page.locator('[data-testid="chat-message-1"] .chat-message-content')
  ).toHaveText(/Initial response/);
});
