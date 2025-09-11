
import { test } from './fixtures';
import type { Buffer } from 'buffer';
import { ChatPage } from './pom/ChatPage';
import { createStreamResponse, expect, OPENROUTER_API_KEY, seedLocalStorage } from "./test-helpers";

interface ChatRequestBody {
  model: string;
}

test('sends a message and sees the response', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.gotoNewChat();

  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Hello!');
    await route.fulfill({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 200,
      body: responseBody,
    });
  });

  const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Hello');
  await responsePromise;

  await chatPage.expectMessage(0, 'user', /Hello/);
  await chatPage.expectMessage(1, 'assistant', /Hello!/);

  // Send a second message
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Second message');
  await responsePromise2;

  await chatPage.expectMessage(2, 'user', /Second message/);
  await chatPage.expectMessage(3, 'assistant', /Hello!/);
});

test('can select a model and get a model-specific response', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.gotoNewChat();

  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const requestBody = (await route.request().postDataJSON()) as ChatRequestBody;
    const model = requestBody.model;

    let responseBody: Buffer;
    if (model === 'mock-model/mock-model') {
      responseBody = createStreamResponse(model, 'Response from Mock Model');
    } else {
      responseBody = createStreamResponse('openai/gpt-4o', 'Hello!');
    }
    await route.fulfill({ body: responseBody, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });

  // The first message will use the default model
  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Hello');
  await responsePromise1;
  await chatPage.expectMessage(1, 'assistant', /Hello!/);

  // Select the mock model
  await chatPage.modelCombobox.selectModel('Mock Model', 'mock-model/mock-model');
  await chatPage.modelCombobox.expectInputValue('mock-model/mock-model');

  // Send a message with the new model
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Another message');
  await responsePromise2;

  // Check for the mock model's specific response and details
  await chatPage.expectMessage(3, 'assistant', /Response from Mock Model/);
  await expect(
    page.locator('[data-testid="chat-message-3"][data-role="assistant"] .chat-message-role')
  ).toHaveText('assistant (mock-model/mock-model)');
});

test('can regenerate an assistant response', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.gotoNewChat();

  // 1. Send an initial message and get a response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Hello!');
    await route.fulfill({ body: responseBody, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });

  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Initial message');
  await responsePromise1;

  // Verify initial messages
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await chatPage.expectMessage(1, 'assistant', /Hello!/);
  await chatPage.expectMessageCount(2);

  // 2. Mock the next response to be different.
  await page.unroute('https://openrouter.ai/api/v1/chat/completions');
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'This is a regenerated response.');
    await route.fulfill({ body: responseBody, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });

  // 3. Click the regenerate button on the assistant's message
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.regenerateMessage(1);
  await responsePromise2;

  // 4. Assertions
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await chatPage.expectMessage(1, 'assistant', /This is a regenerated response./);
  await chatPage.expectMessageCount(2);
});

test('shows system prompt immediately in a new chat', async ({ page, context }) => {
  const chatPage = new ChatPage(page);

  // 1. Setup State and Mock APIs
  await seedLocalStorage(context, {
    'tomatic-storage': {
      state: {
        apiKey: OPENROUTER_API_KEY,
        systemPrompts: [{ name: 'TestPrompt', prompt: 'You are a test bot.' }],
        selectedPromptName: 'TestPrompt',
      },
      version: 0,
    },
  });

  // 2. Navigate
  await page.goto('/settings');
  await chatPage.navigation.goToNewChat();

  // 3. Assert
  await chatPage.expectMessage(0, 'system', /You are a test bot/);
});

test('can edit a user message and resubmit', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.gotoNewChat();

  // 1. Send an initial message and get a response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Initial response');
    await route.fulfill({ body: responseBody, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });
  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Initial message');
  await responsePromise1;

  // Verify initial messages
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await chatPage.expectMessage(1, 'assistant', /Initial response/);
  await chatPage.expectMessageCount(2);

  // 2. Mock the next response for the edited message.
  await page.unroute('https://openrouter.ai/api/v1/chat/completions');
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Response to edited message.');
    await route.fulfill({ body: responseBody, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });

  // 3. Edit the message and re-submit
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.editMessage(0, 'Edited message');
  await responsePromise2;

  // 4. Assertions
  await chatPage.expectMessage(0, 'user', /Edited message/);
  await chatPage.expectMessage(1, 'assistant', /Response to edited message./);
  await chatPage.expectMessageCount(2);
});

test('can edit a user message and discard changes', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.gotoNewChat();

  // 1. Send an initial message and get a response
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const responseBody: Buffer = createStreamResponse('openai/gpt-4o', 'Initial response');
    await route.fulfill({ body: responseBody, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  });
  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Initial message');
  await responsePromise1;

  // Verify initial messages
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await chatPage.expectMessage(1, 'assistant', /Initial response/);

  // 2. Click the edit button, change the text, then cancel.
  await chatPage.cancelEdit(0);

  // 3. Assertions
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await expect(chatPage.page.locator('[data-testid="chat-message-0"] [data-testid="edit-textarea"]')).not.toBeVisible();
  await chatPage.expectMessage(1, 'assistant', /Initial response/);
});
