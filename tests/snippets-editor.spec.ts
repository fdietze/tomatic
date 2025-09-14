import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker, seedIndexedDB } from './test-helpers';
test.describe('Snippet Editor Validation', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ context, page }) => {
    await mockGlobalApis(context);

    await seedLocalStorage(context, {
      state: {
        apiKey: OPENROUTER_API_KEY,
        modelName: 'google/gemini-2.5-pro',
        cachedModels: [],
        input: '',
        selectedPromptName: null,
        autoScrollEnabled: false,
      },
      version: 1,
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

  test.describe('shows a live error when an edit introduces a snippet cycle', () => {
    test.use({ expectedConsoleErrors: [/\[validateSnippetDependencies\] Cycle detected: @b -> @b/] });
    test('shows a live error in the UI', async () => {
      // Purpose: This test verifies that the snippet editor provides immediate feedback when an
      // edit to a generated snippet's prompt would create a dependency cycle. It checks that
      // an error message is displayed and the regenerate/save buttons are in the correct state.
      await settingsPage.startEditingSnippet('b');
      const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');
      await editContainer.getByTestId('snippet-prompt-input').fill('this prompt now references @b');
      const contentDisplay = editContainer.getByTestId('snippet-content-display');
      await expect(contentDisplay.locator('.error-message')).toHaveText('Snippet cycle detected: @b -> @b');
      await expect(editContainer.getByTestId('snippet-regenerate-button')).toBeDisabled();
      await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
      await settingsPage.saveSnippet();
      await expect(editContainer).not.toBeVisible();
    });
  });

  test('shows a warning when a generated snippet prompt references a non-existent snippet', async () => {
    // Purpose: This test verifies that the snippet editor displays a non-blocking warning if
    // a generated snippet's prompt refers to a snippet that does not exist.
    await settingsPage.startEditingSnippet('b');
    const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

    await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nonexistent');
    
    const contentDisplay = editContainer.getByTestId('snippet-content-display');
    await expect(contentDisplay.locator('.error-message')).toHaveText("Warning: Snippet '@nonexistent' not found.");
    
    // Save should still be enabled for warnings
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
  });

  test('shows a warning when a standard snippet content references a non-existent snippet', async () => {
    // Purpose: This test verifies that the snippet editor displays a non-blocking warning if
    // a standard snippet's content refers to a snippet that does not exist.
    // 1. Create a new standard snippet
    await settingsPage.newSnippetButton.click();
    const editContainer = settingsPage.page.getByTestId('snippet-item-edit-new');

    // 2. Fill the content with a reference to a non-existent snippet
    await editContainer.getByTestId('snippet-content-input').fill('this content references @nonexistent');

    // 3. Assert that the warning is shown below the content input
    await expect(editContainer.getByTestId('prompt-error-message')).toHaveText("Warning: Snippet '@nonexistent' not found.");
    
    // 4. Save should still be enabled
    await expect(editContainer.getByTestId('snippet-save-button')).toBeEnabled();
  });

  test.describe('shows both a cycle error and a non-existent snippet warning', () => {
    test.use({ expectedConsoleErrors: [/\[validateSnippetDependencies\] Cycle detected: @b -> @b/] });
    test('shows both errors in the UI', async () => {
      // Purpose: This test ensures the UI can display multiple validation messages simultaneously,
      // showing both a cycle error and a non-existent snippet warning when an edit introduces
      // both issues.
      await settingsPage.startEditingSnippet('b');
      const editContainer = settingsPage.page.locator('[data-testid^="snippet-item-edit-"]');

      // Introduce a cycle and a reference to a non-existent snippet
      await editContainer.getByTestId('snippet-prompt-input').fill('this prompt references @nonexistent and also @b');

      const errorContainer = editContainer.getByTestId('prompt-error-message');
      await expect(errorContainer).toContainText('Snippet cycle detected: @b -> @b');
      await expect(errorContainer).toContainText("Warning: Snippet '@nonexistent' not found.");
    });
  });

  test.describe('shows a cycle error for mixed-type snippet cycles', () => {
    test.use({ expectedConsoleErrors: [/\[validateSnippetDependencies\] Cycle detected: @d -> @b -> @d/] });
    test('shows the cycle error in the UI', async () => {
      // Purpose: This test verifies that cycle detection works correctly across different snippet
      // types (e.g., a standard snippet referencing a generated snippet, which in turn
      // references the standard one).
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
  });

  test('can save a generated snippet that references a non-existent snippet', async () => {
    // Purpose: This test ensures that a user can save a generated snippet even if its prompt
    // contains a warning (like a non-existent snippet reference), as warnings should not
    // block saving.
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
    // Purpose: This test verifies the two-step process for updating a generated snippet: first,
    // the user can regenerate the content based on a new prompt, see the result in the
    // editor, and only then save the entire snippet.
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
    // Purpose: This test verifies that if a generated snippet's prompt resolves to an empty or
    // whitespace-only string, the system skips making an API call and simply clears the
    // snippet's content.
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