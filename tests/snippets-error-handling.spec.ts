import { testWithAutoInit as test } from './fixtures';
import { SettingsPage } from './pom/SettingsPage';
import { expect, ChatCompletionMocker } from './test-helpers';

test.describe('Generated Snippets (Error Handling)', () => {
  let settingsPage: SettingsPage;

  test.beforeEach(async ({ page }) => {
    settingsPage = new SettingsPage(page);
    const chatMocker = new ChatCompletionMocker(page);
    await chatMocker.setup();

    // Navigate to settings using UI navigation instead of page.goto
    await settingsPage.navigation.goToSettings();
  });

  test('shows an error if snippet generation fails', async ({ expectedConsoleErrors }) => {
    expectedConsoleErrors.push(/Failed to load resource.*500/);
    expectedConsoleErrors.push(/Internal Server Error/);
    // Purpose: This test verifies that if the API call for generating a snippet's content fails,
    // an appropriate error message is displayed to the user within the snippet editor.
    const chatMocker = new ChatCompletionMocker(settingsPage.page);
    await chatMocker.setup();
    chatMocker.mock({
      request: {
        model: "mock-model/mock-model",
        messages: [{ role: "user", content: "This will fail" }],
        stream: false,
      },
      response: {
        role: "assistant",
        content: "",
        error: { status: 500, message: "Internal Server Error" },
      },
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
    await settingsPage.expectGenerationErrorMessage(/API Error: 500 Internal Server Error/);
  });
});
