import { test } from './fixtures';
import { ChatPage } from './pom/ChatPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';
import { SettingsPage } from './pom/SettingsPage';

test.describe('Snippet Usage in System Prompts', () => {
  let chatPage: ChatPage;
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    chatPage = new ChatPage(page);
    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    
  });

  test('resolves snippets in a system prompt for a new chat', async ({ context, page }) => {
    // Purpose: This test verifies that a snippet placeholder in a system prompt is correctly resolved with the snippet's content when a new chat is started.
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        selectedPromptName: 'TestPrompt',
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      system_prompts: [{ name: 'TestPrompt', prompt: 'You are a @character.' }],
      snippets: [{ name: 'character', content: 'helpful assistant', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false }],
    });

    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello' }
        ],
      },
      response: { role: 'assistant', content: 'Response.' },
    });
    
    await chatPage.goto();
    const responsePromise = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('Hello');
    await responsePromise;

    await chatPage.expectMessage(0, 'system', /^You are a @character\.\s*$/);
    await chatPage.expectMessage(1, 'user', /^Hello\s*$/);
    await chatPage.expectMessage(2, 'assistant', /^Response\.\s*$/);
    chatMocker.verifyComplete();
  });

  test('uses updated snippet content when regenerating a response', async ({ context, page }) => {
    // Purpose: This test ensures that if a snippet's content is updated via the UI, the regenerated response from the model uses the new content.
    // 1. Initial Setup via UI
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
        autoScrollEnabled: false,
        selectedPromptName: null,
      },
      version: 1,
    });

    await settingsPage.goto();
    await settingsPage.createNewSnippet('character', 'helpful assistant');
    await settingsPage.createNewPrompt('TestPrompt', 'You are a @character.');
    
    // 2. Mock initial and regenerated responses
    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' }
        ],
      },
      response: { role: 'assistant', content: 'Initial Response.' },
    });
    chatMocker.mock({
      request: {
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'system', content: 'You are a fearsome pirate.' },
          { role: 'user', content: 'Hello' }
        ],
      },
      response: { role: 'assistant', content: 'Regenerated Pirate Response.' },
    });

    // 3. Initial chat
    await chatPage.goto();
    await page.getByTestId('system-prompt-button-TestPrompt').click();

    const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('Hello');
    await responsePromise1;
    await chatPage.expectMessage(2, 'assistant', /Initial Response/);

    // 4. Update snippet via UI
    const chatUrl = page.url(); // Store the chat URL
    await settingsPage.goto();
    await settingsPage.startEditingSnippet('character');
    await settingsPage.fillSnippetForm('character', 'fearsome pirate');
    await settingsPage.saveSnippet();

    // 5. Regenerate and assert
    await page.goto(chatUrl); // Go back to the chat

    const regenerateButton = chatPage.getMessageLocator(2).getByTestId('regenerate-button');
    await expect(regenerateButton).toBeVisible(); // <-- Add this wait

    const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.regenerateMessage(2);
    await responsePromise2;
    await chatPage.expectMessage(0, 'system', /^You are a @character\.\s*$/);
    await chatPage.expectMessage(1, 'user', /^Hello\s*$/);
    await chatPage.expectMessage(2, 'assistant', /Regenerated Pirate Response/);
    chatMocker.verifyComplete();
  });

  test('shows an error if a system prompt snippet is not found', async ({ context }) => {
    // Purpose: This test checks that a clear error message is displayed to the user if a snippet referenced in the system prompt does not exist.
    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        selectedPromptName: 'TestPrompt',
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
        autoScrollEnabled: false,
      },
      version: 1,
    });
    await seedIndexedDB(context, {
      system_prompts: [{ name: 'TestPrompt', prompt: 'You are a @fake_character.' }],
    });
    
    await chatPage.goto();
     await chatPage.sendMessage('Hello');

    await expect(chatPage.page.getByTestId('error-message').locator('p')).toHaveText(
      "Snippet '@fake_character' not found."
    );
     await expect(chatPage.errorMessage).toBeVisible();
    chatMocker.verifyComplete();
  });

  test('uses updated, transitively dependent snippet content when regenerating a response', async ({ context, page }) => {
    // Purpose: This test ensures that when a base snippet is updated, a generated snippet that depends on it is regenerated first,
    // and only then is a chat message using that generated snippet (via a system prompt) regenerated with the newest content.
    // It specifically tests the async waiting logic.

    // 1. Initial Setup
    await seedLocalStorage(context, {
      state: { apiKey: OPENROUTER_API_KEY, modelName: 'google/gemini-2.5-pro', cachedModels: [], input: '', autoScrollEnabled: false, selectedPromptName: null },
      version: 1,
    });
    await seedIndexedDB(context, {
      system_prompts: [{ name: 'TestPrompt', prompt: 'You are a @generated_snippet.' }],
      snippets: [
        { name: 'base_snippet', content: 'v1', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'generated_snippet', content: 'generated from v1', isGenerated: true, prompt: 'generate from @base_snippet', model: 'mock-model/mock-model', createdAt_ms: 1, updatedAt_ms: 1, generationError: null, isDirty: false },
      ],
    });

    // 2. Mock initial and regenerated responses
    chatMocker.mock({
      request: { model: 'google/gemini-2.5-pro', messages: [{ role: 'system', content: 'You are a generated from v1.' }, { role: 'user', content: 'Hello' }] },
      response: { role: 'assistant', content: 'Initial Response.' },
    });
    // This is the mock for the snippet's regeneration. No longer manual.
    chatMocker.mock({
      request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'generate from v2' }] },
      response: { role: 'assistant', content: 'generated from v2' },
    });
    chatMocker.mock({
      request: { model: 'google/gemini-2.5-pro', messages: [{ role: 'system', content: 'You are a generated from v2.' }, { role: 'user', content: 'Hello' }] },
      response: { role: 'assistant', content: 'Regenerated Response.' },
    });

    // 3. Initial chat
    await chatPage.goto();
    await page.getByTestId('system-prompt-button-TestPrompt').click();
    const responsePromise1 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.sendMessage('Hello');
    await responsePromise1;
    await chatPage.expectMessage(2, 'assistant', /Initial Response/);

    // 4. Update snippet via UI, which triggers the chain
    const chatUrl = page.url();
    await settingsPage.goto();
    await settingsPage.startEditingSnippet('base_snippet');
    await settingsPage.fillSnippetForm('base_snippet', 'v2');
    await settingsPage.saveSnippet();

    // Give the regeneration a moment to complete in the background.
    await page.waitForTimeout(500);

    // 6. Navigate back to chat and trigger regeneration.
    await page.goto(chatUrl);

    const responsePromise2 = page.waitForResponse('https://openrouter.ai/api/v1/chat/completions');
    await chatPage.regenerateMessage(2);

    // 7. The final chat regeneration should now proceed with the updated content.
    await responsePromise2;
    await chatPage.expectMessage(2, 'assistant', /Regenerated Response/);
    chatMocker.verifyComplete();
  });
});
