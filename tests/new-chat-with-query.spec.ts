import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import { expect, mockGlobalApis, seedLocalStorage, createStreamResponse, OPENROUTER_API_KEY } from './test-helpers';

test.describe('New Chat via Query Parameter', () => {
  test('should create a new session and submit the query parameter as the first message', async ({
    context,
    page,
  }) => {
    // 1. Setup mocks and initial state
    await mockGlobalApis(context);
    // Seed a selected system prompt to ensure it gets ignored by the query chat flow.
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: {
          apiKey: OPENROUTER_API_KEY,
          selectedPromptName: 'test-prompt',
        },
        version: 0
      }
    });

    // Mock the chat stream response
    await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      const requestBody = route.request().postDataJSON() as { model?: string };
      const model = requestBody.model || 'mock-model';
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: createStreamResponse(model, 'This is a mocked response.'),
      });
    });

    // 2. Navigate to the page with the query parameter
    await page.goto('/chat/new?q=Hello from the test');
    const chatPage = new ChatPage(page);

    // 3. Wait for navigation to the new session URL
    await page.waitForURL(/\/chat\/[a-f0-9-]+/);

    // 4. Verify that only the user and assistant messages are present (no system prompt)
    await chatPage.expectMessageCount(2);
    await chatPage.expectMessage(0, 'user', /Hello from the test/);

    // 5. Verify the mocked assistant response is displayed
    await chatPage.expectMessage(1, 'assistant', /This is a mocked response./);

    // 6. Verify the URL no longer contains the query parameter
    expect(page.url()).not.toContain('?q=');
  });
});
