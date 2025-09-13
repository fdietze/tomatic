import { test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, mockGlobalApis, OPENROUTER_API_KEY, seedLocalStorage, ChatCompletionMocker } from './test-helpers';

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