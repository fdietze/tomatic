import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import {
  OPENROUTER_API_KEY,
  seedLocalStorage,
  ChatCompletionMocker,
  seedIndexedDB,
  expect,
} from './test-helpers';

test.describe('Chat Editing with Snippets', () => {
  let chatPage: ChatPage;
  let chatMocker: ChatCompletionMocker;

  test('can edit a message to use a different snippet and preserves raw content', async ({
    context,
    page,
  }) => {
    // 1. Define Mock Data
    const MOCK_SNIPPETS = [
        { name: 'greet', content: 'Hello', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'farewell', content: 'Goodbye', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
    ];

    const SESSION_WITH_SNIPPET = {
      session_id: 'session-edit-snippet',
      name: null,
      messages: [
        {
          id: 'msg1',
          role: 'user' as const,
          content: 'Hello world', // Resolved content
          raw_content: '@greet world', // Original user input
        },
        {
          id: 'msg2',
          role: 'assistant' as const,
          content: 'Initial response',
          model_name: 'google/gemini-2.5-pro',
        },
      ],
      created_at_ms: 1000,
      updated_at_ms: 1000,
    };

    // 2. Seed Data and Mock APIs
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY },
        version: 1,
      },
    });
    await seedIndexedDB(context, {
      snippets: MOCK_SNIPPETS,
      chat_sessions: [SESSION_WITH_SNIPPET],
    });
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // 3. Navigate and create POMs
    await page.goto(`/chat/${SESSION_WITH_SNIPPET.session_id}`);
    chatPage = new ChatPage(page);

    // 4. Verify initial state
    await chatPage.expectMessage(0, 'user', /@greet world/);
    await chatPage.expectMessage(1, 'assistant', /Initial response/);
    await chatPage.expectMessageCount(2);

    // 5. Start editing the message
    await chatPage.startEditingMessage(0);

    // 6. Assert the textarea contains the original raw content
    await expect(chatPage.getEditTextArea(0)).toHaveValue('@greet world');

    // 7. Edit the content to use a different snippet
    await chatPage.getEditTextArea(0).fill('@farewell world');
    
    // 8. Mock the API call for the resubmission
    chatMocker.mock({
        request: {
            model: 'google/gemini-2.5-pro',
            messages: [{ role: 'user', content: 'Goodbye world' }], // Should be resolved
        },
        response: { role: 'assistant', content: 'Response to edited message.' },
    });

    // 9. Resubmit the edit
    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.resubmitEdit(0);
    await responsePromise;

    // 10. Assert the final state
    await chatPage.expectMessageCount(2); // History is truncated before new response
    await chatPage.expectMessage(0, 'user', /@farewell world/); // Displays new raw_content
    await chatPage.expectMessage(1, 'assistant', /Response to edited message/);
    
    // 11. Verify mocks
    chatMocker.verifyComplete();
  });
});
