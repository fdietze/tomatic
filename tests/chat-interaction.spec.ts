
import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import {
  ChatCompletionMocker,
  expect,
  mockGlobalApis,
  OPENROUTER_API_KEY,
  seedLocalStorage,
} from './test-helpers';


test.beforeEach(async ({ context }) => {
  await mockGlobalApis(context);
});
test('sends a message and sees the response', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.goto();

  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    },
    response: { role: 'assistant', content: 'Hello!' },
  });
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Second message' },
      ],
    },
    response: { role: 'assistant', content: 'Hello again!' },
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
  await chatPage.expectMessage(3, 'assistant', /Hello again!/);

  chatMocker.verifyComplete();
});

test('can select a model and get a model-specific response', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();
  await chatPage.goto();

  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    },
    response: { role: 'assistant', content: 'Hello!' },
  });
  chatMocker.mock({
    request: {
      model: 'mock-model/mock-model',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Another message' },
      ],
    },
    response: { role: 'assistant', content: 'Response from Mock Model' },
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

  chatMocker.verifyComplete();
});

test('can regenerate an assistant response', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.goto();

  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();

  // 1. Mock the initial response
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user' as const, content: 'Initial message' }],
    },
    response: { role: 'assistant' as const, content: 'Hello!' },
  });

  // 2. Mock the regenerated response for the *same* request
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user' as const, content: 'Initial message' }],
    },
    response: { role: 'assistant' as const, content: 'This is a regenerated response.' },
  });

   // 3. Send the first message and await the response
   const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
   await chatPage.sendMessage('Initial message');
   await responsePromise1;
 
   // Verify initial messages
   await chatPage.expectMessage(0, 'user', /Initial message/);
   await chatPage.expectMessage(1, 'assistant', /Hello!/);
   await chatPage.expectMessageCount(2);
 
   // 4. Click the regenerate button and await the new response
   const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
   await chatPage.regenerateMessage(1);
   await responsePromise2;
 
   // 5. Assertions
   await chatPage.expectMessage(0, 'user', /Initial message/);
   await chatPage.expectMessage(1, 'assistant', /This is a regenerated response./);
   await chatPage.expectMessageCount(2);
 
   // 6. Verify all mocks were consumed
   chatMocker.verifyComplete();
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
  await chatPage.goto();

  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();

  // 1. Mock the initial response
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Initial message' }],
    },
    response: { role: 'assistant', content: 'Initial response' },
  });

  // 2. Mock the response for the edited message
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Edited message' }],
    },
    response: { role: 'assistant', content: 'Response to edited message.' },
  });

  // 3. Send an initial message and get a response
  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Initial message');
  await responsePromise1;

  // Verify initial messages
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await chatPage.expectMessage(1, 'assistant', /Initial response/);
  await chatPage.expectMessageCount(2);

  // 4. Edit the message and re-submit
  const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.editMessage(0, 'Edited message');
  await responsePromise2;

  // 5. Assertions
  await chatPage.expectMessage(0, 'user', /Edited message/);
  await chatPage.expectMessage(1, 'assistant', /Response to edited message./);
  await chatPage.expectMessageCount(2);

  // 6. Verify all mocks were consumed
  chatMocker.verifyComplete();
});

test('can edit a user message and discard changes', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': { state: { apiKey: OPENROUTER_API_KEY }, version: 0 },
  });
  const chatPage = new ChatPage(page);
  await chatPage.goto();
  const chatMocker = new ChatCompletionMocker(page);

  await chatMocker.setup();

  // 1. Send an initial message and get a response
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Initial message' }],
    },
    response: { role: 'assistant', content: 'Initial response' },
  });

  const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
  await chatPage.sendMessage('Initial message');
  await responsePromise1;

  // Verify initial messages
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await chatPage.expectMessage(1, 'assistant', /Initial response/);

  // 2. Click the edit button, change the text, then cancel.
  await chatPage.cancelEdit(0, 'This text will be discarded');

  // 3. Assertions
  await chatPage.expectMessage(0, 'user', /Initial message/);
  await expect(page.locator('[data-testid="chat-message-0"] [data-testid="edit-textarea"]')).not.toBeVisible();
  await chatPage.expectMessage(1, 'assistant', /Initial response/);

    // 4. Verify all mocks were consumed
  chatMocker.verifyComplete();
});
