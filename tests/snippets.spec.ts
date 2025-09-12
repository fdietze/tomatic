
import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { ChatPage } from './pom/ChatPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';

test.describe('Snippet Management (CRUD)', () => {
  let settingsPage: SettingsPage;

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

    settingsPage = new SettingsPage(page);
    await settingsPage.goto();
  });

  test('creates a new standard snippet', async () => {
    await settingsPage.createNewSnippet('greet', 'Hello, world!');

    await settingsPage.expectSnippetToBeVisible('greet');
    await expect(settingsPage.getSnippetItem('greet')).toHaveText(/Hello, world!/);
  });

  test('updates an existing snippet', async () => {
    await settingsPage.createNewSnippet('my_snippet', 'Initial content');
    await settingsPage.expectSnippetToBeVisible('my_snippet');

    await settingsPage.startEditingSnippet('my_snippet');
    await settingsPage.fillSnippetForm('my_renamed_snippet', 'Updated content');
    await settingsPage.saveSnippet();

    await settingsPage.expectSnippetToNotExist('my_snippet');
    await settingsPage.expectSnippetToBeVisible('my_renamed_snippet');
    await expect(settingsPage.getSnippetItem('my_renamed_snippet')).toHaveText(/Updated content/);
  });

  test('deletes a snippet', async () => {
    await settingsPage.createNewSnippet('to_delete', 'I am temporary');
    await settingsPage.expectSnippetToBeVisible('to_delete');

    await settingsPage.deleteSnippet('to_delete');

    await settingsPage.expectSnippetToNotExist('to_delete');
  });
});


test.describe('Generated Snippets', () => {
  let settingsPage: SettingsPage;
  let chatMocker: ChatCompletionMocker;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY, snippets: [] },
        version: 1,
      },
    });

    settingsPage = new SettingsPage(page);
    chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    await settingsPage.goto();
  });

  test('UI shows correct fields for a generated snippet', async ({ page }) => {
    await settingsPage.newSnippetButton.click();
    const editContainer = page.getByTestId('snippet-item-edit-new');

    // Initially, content is an editable textarea
    await expect(editContainer.getByTestId('snippet-content-input')).toBeVisible();
    await expect(editContainer.getByTestId('snippet-prompt-input')).not.toBeVisible();
    await expect(page.getByTestId('model-combobox-input')).not.toBeVisible();
    await expect(editContainer.getByTestId('snippet-content-display')).not.toBeVisible();

    // Check the "Generated Snippet" box
    await editContainer.getByText('Generated Snippet').click();

    // Now, prompt and model are visible, and content is a read-only display
    await expect(editContainer.getByTestId('snippet-prompt-input')).toBeVisible();
    await expect(page.getByTestId('model-combobox-input')).toBeVisible();
    await expect(editContainer.getByTestId('snippet-content-display')).toBeVisible();
    await expect(editContainer.getByTestId('snippet-content-input')).not.toBeVisible();
  });

  test('creates a new generated snippet', async () => {
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a joke' }],
      },
      response: { role: 'assistant', content: 'Why did the scarecrow win an award? Because he was outstanding in his field!' },
    });

    await settingsPage.createGeneratedSnippet('joke', 'Tell me a joke', 'mock-model/mock-model', 'Mock Model');

    await settingsPage.expectSnippetToBeVisible('joke');
    await settingsPage.expectGeneratedSnippetContent('joke', /outstanding in his field/);

    chatMocker.verifyComplete();
  });

  test('updates a generated snippet', async () => {
    // 1. Mock initial creation
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a joke' }],
      },
      response: { role: 'assistant', content: 'Why did the scarecrow win an award? Because he was outstanding in his field!' },
    });
    await settingsPage.createGeneratedSnippet('joke', 'Tell me a joke', 'mock-model/mock-model', 'Mock Model');
    await settingsPage.expectSnippetToBeVisible('joke');
    await settingsPage.expectGeneratedSnippetContent('joke', /outstanding in his field/);

    // 2. Mock the update/regeneration
    chatMocker.mock({
      request: {
        model: 'mock-model/mock-model',
        messages: [{ role: 'user', content: 'Tell me a short story' }],
      },
      response: { role: 'assistant', content: 'Once upon a time...' },
    });

    // 3. Perform the update
    await settingsPage.startEditingSnippet('joke');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');
    await settingsPage.fillGeneratedSnippetForm({ name: 'joke_story', prompt: 'Tell me a short story' });
    await editContainer.getByTestId('snippet-regenerate-button').click();
    await settingsPage.saveSnippet();

    // 4. Verify the update
    await settingsPage.expectSnippetToNotExist('joke');
    await settingsPage.expectSnippetToBeVisible('joke_story');
    await settingsPage.expectGeneratedSnippetContent('joke_story', /Once upon a time/);

    // 5. Verify mocks
    chatMocker.verifyComplete();
  });
});

test.describe('Generated Snippets (Error Handling)', () => {
  test.use({ expectedConsoleErrors: [/Internal Server Error/] });
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);
    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY, snippets: [] },
        version: 1,
      },
    });

    settingsPage = new SettingsPage(page);
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    await settingsPage.goto();
  });

  test('shows an error if snippet generation fails', async () => {
    await settingsPage.page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Internal Server Error' } }),
      });
    });

    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.page.getByTestId('snippet-item-edit-new');
    await editContainer.getByTestId('snippet-name-input').fill('bad_joke');
    await editContainer.getByText('Generated Snippet').click();
    await settingsPage.modelCombobox.selectModel('Mock Model', 'mock-model/mock-model');
    await editContainer.getByTestId('snippet-prompt-input').fill('This will fail');
    await editContainer.getByTestId('snippet-regenerate-button').click();

    // The edit form should remain open and show an error
    await expect(editContainer).toBeVisible();
    await settingsPage.expectGenerationErrorMessage(/Generation failed:/);
  });
});

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

test.describe('Snippet Editor Validation', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: { apiKey: OPENROUTER_API_KEY },
        version: 1,
      },
    });

    await seedIndexedDB(context, {
      snippets: [
        { name: 'a', content: 'alpha', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'b', content: '', isGenerated: true, prompt: 'no cycle here', createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'c', content: 'charlie', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
        { name: 'empty', content: '   ', isGenerated: false, createdAt_ms: 0, updatedAt_ms: 0, generationError: null, isDirty: false },
      ],
    });

    settingsPage = new SettingsPage(page);
    await settingsPage.goto();
  });

  test('shows a live error when an edit introduces a snippet cycle', async () => {
    // 1. Start editing snippet 'b'
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // 2. Introduce a cycle by making 'b's prompt reference itself
    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt now references @b');
    
    // 3. Assert that the error is shown in the content preview area
    const contentDisplay = editContainer.getByTestId('snippet-content-display');
    await expect(contentDisplay.locator('.error-message')).toHaveText('Snippet cycle detected: @b -> @b');
    
    // 4. The regenerate button should be disabled due to the cycle error.
    await expect(editContainer.getByTestId('snippet-regenerate-button')).toBeDisabled();
    
    // 5. The save button should still be enabled.
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();

    // 6. Save the snippet (which is allowed)
    await settingsPage.saveSnippet();
    
    // 7. The editor should close
    await expect(editContainer).not.toBeVisible();
  });

  test('shows a warning when a generated snippet prompt references a non-existent snippet', async () => {
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nonexistent');
    
    const contentDisplay = editContainer.getByTestId('snippet-content-display');
    await expect(contentDisplay.locator('.error-message')).toHaveText("Warning: Snippet '@nonexistent' not found.");
    
    // Save should still be enabled for warnings
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
  });

  test('shows a warning when a standard snippet content references a non-existent snippet', async () => {
    // 1. Create a new standard snippet
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.page.getByTestId('snippet-item-edit-new');

    // 2. Fill the content with a reference to a non-existent snippet
    await editContainer.getByTestId('snippet-content-input').fill('this content references @nonexistent');

    // 3. Assert that the warning is shown below the content input
    await expect(editContainer.locator('.error-message')).toHaveText("Warning: Snippet '@nonexistent' not found.");
    
    // 4. Save should still be enabled
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
  });

  test('shows both a cycle error and a non-existent snippet warning', async () => {
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // Introduce a cycle and a reference to a non-existent snippet
    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nonexistent and also @b');

    const errorContainer = editContainer.getByTestId('prompt-error-message');
    await expect(errorContainer).toContainText('Snippet cycle detected: @b -> @b');
    await expect(errorContainer).toContainText("Warning: Snippet '@nonexistent' not found.");
  });

  test('shows a cycle error for mixed-type snippet cycles', async () => {
    // 1. Create a new standard snippet 'd' that references generated snippet 'b'
    await settingsPage.createNewSnippet('d', 'Standard snippet referencing @b');

    // 2. Start editing generated snippet 'b'
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid="snippet-item-edit-b"]');

    // 3. Update 'b's prompt to reference standard snippet 'd', creating a cycle: b (prompt) -> d (content) -> b
    await editContainer.getByTestId('snippet-prompt-input').fill('Generated prompt referencing @d');
    
    // 4. Assert that the cycle error is shown in 'b's editor
    const errorContainer = editContainer.getByTestId('prompt-error-message');
    // The starting point of the cycle detection can vary, so we check for the presence of both snippets.
    await expect(errorContainer).toContainText('Snippet cycle detected:');
    await expect(errorContainer).toContainText('@b');
    await expect(errorContainer).toContainText('@d');
  });

  test('can save a generated snippet that references a non-existent snippet', async () => {
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');
    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nope');
    await expect(editContainer.getByTestId('prompt-error-message')).toHaveText("Warning: Snippet '@nope' not found.");

    // The regenerate button should be disabled due to the error.
    await expect(editContainer.getByTestId('snippet-regenerate-button')).toBeDisabled();
    
    // But the save button should be enabled.
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();

    await settingsPage.saveSnippet();

    await settingsPage.expectSnippetToBeVisible('b');
    await expect(editContainer).not.toBeVisible();
    await expect(settingsPage.getSnippetItem('b').locator('.system-prompt-text')).toHaveText('');

    await settingsPage.startEditingSnippet('b');
    await expect(editContainer.getByTestId('prompt-error-message')).toHaveText("Warning: Snippet '@nope' not found.");
  });

  test('regenerates content and saves separately', async ({ page }) => {
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();
    chatMocker.mock({
      request: { model: 'mock-model/mock-model', messages: [{ role: 'user', content: 'A new prompt' }] },
      response: { role: 'assistant', content: 'A new generated content' },
    });

    // 1. Start editing
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // 2. Change prompt and model
    await settingsPage.fillGeneratedSnippetForm({ prompt: 'A new prompt', modelName: 'Mock Model', modelId: 'mock-model/mock-model' });
    
    // 3. Regenerate
    await editContainer.getByTestId('snippet-regenerate-button').click();

    // 4. Assert new content is in the editor, and editor is still open
    await expect(editContainer.getByTestId('snippet-content-display')).toHaveText(/A new generated content/);
    await expect(editContainer).toBeVisible();

    // 5. Save
    await settingsPage.saveSnippet();

    // 6. Assert editor is closed and final content is displayed
    await expect(editContainer).not.toBeVisible();
    await settingsPage.expectGeneratedSnippetContent('b', /A new generated content/);
    chatMocker.verifyComplete();
  });

  test('skips generation if resolved prompt is empty', async ({ page }) => {
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup(); // No mocks, as no API call should be made

    // 1. Start editing
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    // 2. Set prompt to a snippet that will resolve to an empty string
    await editContainer.getByTestId('snippet-prompt-input').fill('@empty');

    // 3. Click regenerate
    await editContainer.getByTestId('snippet-regenerate-button').click();

    // 4. Assert content is now empty and editor is still open.
    // The display should only contain the label, signifying no markdown content.
    await expect(editContainer.getByTestId('snippet-content-display')).toHaveText('Content (read-only)');
    await expect(editContainer).toBeVisible();

    // 5. Save and assert it's saved with empty content
    await settingsPage.saveSnippet();
    await settingsPage.expectGeneratedSnippetContent('b', '');

    chatMocker.verifyComplete(); // Verifies no API call was made
  });
});
