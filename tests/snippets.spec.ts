
import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker } from './test-helpers';

test.describe('Snippet Management (CRUD)', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      'tomatic-storage': {
        state: {
          apiKey: OPENROUTER_API_KEY,
          snippets: [],
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
    await settingsPage.fillGeneratedSnippetForm({ name: 'joke_story', prompt: 'Tell me a short story' });
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

    await settingsPage.createGeneratedSnippet('bad_joke', 'This will fail', 'mock-model/mock-model', 'Mock Model');

    // The edit form should remain open and show an error
    await expect(settingsPage.page.getByTestId('snippet-item-edit-new')).toBeVisible();
    await settingsPage.expectGenerationErrorMessage(/Generation failed:/);
  });
});
