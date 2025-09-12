import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';
test.describe('Snippet Usage in Chat', () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: {
          apiKey: OPENROUTER_API_KEY,
        },
        version: 1,
      },
    });

    // Seed all snippets needed for this test suite
    await seedIndexedDB(context, {
      snippets: [
        { name: 'greet_simple', content: 'Hello, world!', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'greet_nested', content: 'Hello, @name!', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'name', content: 'World', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'cycle_a', content: 'This is a @cycle_b', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'cycle_b', content: 'which contains @cycle_a', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'cycle_self', content: 'This is a @cycle_self', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
      ],
    });

    chatPage = new ChatPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    await chatPage.goto();
  });

  test('resolves a standard snippet in the chat input', async ({ page }) => {
    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hello, world!' }],
      },
      response: { role: 'assistant', content: 'Resolved snippet response.' },
    });

    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('@greet_simple');
    await responsePromise;

    // The user message should display the raw input, not the resolved content
    await chatPage.expectMessage(0, 'user', /@greet_simple/);
    // The assistant response should be visible
    await chatPage.expectMessage(1, 'assistant', /Resolved snippet response/);
    // The API mock should have been hit correctly with the resolved content
    chatMocker.verifyComplete();
  });

  test('resolves nested snippets in the chat input', async ({ page }) => {
    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [{ role: 'user', content: 'Hello, World!' }],
      },
      response: { role: 'assistant', content: 'Nested resolution successful.' },
    });

    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('@greet_nested');
    await responsePromise;

    await chatPage.expectMessage(0, 'user', /@greet_nested/);
    await chatPage.expectMessage(1, 'assistant', /Nested resolution successful/);
    chatMocker.verifyComplete();
  });

  test('shows an error when a snippet is not found', async () => {
    // No API call should be made, so no mock is needed.
    await chatPage.sendMessage('Hello @fake_snippet');

    // Assert that the error message is visible in the UI
    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      "Snippet '@fake_snippet' not found."
    );

    // Assert that no messages were sent
    await chatPage.expectMessageCount(0);

    // Verify no unexpected API calls were made
    chatMocker.verifyComplete();
  });

  test('shows an error when a snippet self-references', async () => {
    await chatPage.sendMessage('@cycle_self');

    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      'Snippet cycle detected: @cycle_self -> @cycle_self'
    );

    await chatPage.expectMessageCount(0);
    chatMocker.verifyComplete();
  });

  test('shows an error when a multi-step snippet cycle is detected', async () => {
    await chatPage.sendMessage('@cycle_a');

    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      'Snippet cycle detected: @cycle_a -> @cycle_b -> @cycle_a'
    );

    await chatPage.expectMessageCount(0);
    chatMocker.verifyComplete();
  });
});