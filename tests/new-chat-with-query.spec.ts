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

test('visiting /chat/new?q=... starts a new chat with the query', async ({ context, page }) => {
  await seedLocalStorage(context, {
    'tomatic-storage': {
      state: {
        apiKey: OPENROUTER_API_KEY,
        // Ensure a system prompt is selected to verify it gets cleared
        systemPrompts: [{ name: 'TestPrompt', prompt: 'You are a test bot.' }],
        selectedPromptName: 'TestPrompt',
      },
      version: 0,
    },
  });

  const chatPage = new ChatPage(page);
  const chatMocker = new ChatCompletionMocker(page);
  await chatMocker.setup();

  // Mock the response for the initial query
  chatMocker.mock({
    request: {
      model: 'google/gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Hello world from query' }],
    },
    response: { role: 'assistant', content: 'Response to query' },
  });

  // Navigate to the URL with the query parameter
  await page.goto('/chat/new?q=Hello%20world%20from%20query');

  // Wait for the API call to complete
  await page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');

  // Assertions
  // 1. There should be no system message
  await expect(page.locator('[data-testid="chat-message-0"][data-role="system"]')).not.toBeVisible();

  // 2. The user's message from the query should be displayed
  await chatPage.expectMessage(0, 'user', /Hello world from query/);

  // 3. The assistant's response should be displayed
  await chatPage.expectMessage(1, 'assistant', /Response to query/);

  // 4. There should be exactly two messages
  await chatPage.expectMessageCount(2);

  // 5. The URL should no longer contain the query parameter
  await expect(page).not.toHaveURL(/q=/);

  // 6. Verify the mock was called
  chatMocker.verifyComplete();
});
